import "server-only";

import type {
  Notification,
  NotificationChannel,
  NotificationKind,
  NotificationSettings,
  Prisma,
  Profile,
} from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { localDateKey, startOfLocalDay } from "@/lib/time";
import { db } from "@/server/db";
import {
  buildDedupeKey,
  shouldDeliver,
  type QuietHours,
} from "@/services/schedule/schedule.derive";

/**
 * Notification creation and delivery bookkeeping.
 *
 * The central guarantee here is IDEMPOTENCY. A worker that retries after a
 * timeout, or two workers that race on the same due reminder, must produce
 * ONE notification — not two identical alerts. `dedupeKey` is unique per
 * profile and the insert is an upsert on that key, so the guarantee is
 * enforced by the DATABASE rather than by hoping the worker behaves.
 */

const log = logger.child({ service: "notification" });

export { buildDedupeKey };

export type EnqueueInput = {
  readonly profileId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body?: string | null;
  /** In-app destination. Never an external URL. */
  readonly href?: string | null;
  /** Stable identity. Composed from what makes the alert unique. */
  readonly dedupeKey: string;
  readonly scheduledFor?: Date;
  readonly channel?: NotificationChannel;
  readonly reminderId?: string | null;
};

/**
 * Creates a notification, or returns the existing one with the same key.
 *
 * Returns `{ created: false }` when the alert already existed, so callers can
 * tell a genuine new notification from a de-duplicated retry — a worker that
 * logged "sent" on every retry would make its own metrics useless.
 */
export async function enqueueNotification(
  input: EnqueueInput,
): Promise<{ readonly notification: Notification; readonly created: boolean }> {
  const existing = await db.notification.findUnique({
    where: {
      profileId_dedupeKey: {
        profileId: input.profileId,
        dedupeKey: input.dedupeKey,
      },
    },
  });

  if (existing) {
    return { notification: existing, created: false };
  }

  try {
    const notification = await db.notification.create({
      data: {
        profileId: input.profileId,
        kind: input.kind,
        channel: input.channel ?? "IN_APP",
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        dedupeKey: input.dedupeKey,
        scheduledFor: input.scheduledFor ?? new Date(),
        reminderId: input.reminderId ?? null,
      },
    });

    return { notification, created: true };
  } catch (error) {
    // Two workers can pass the read above simultaneously; the unique index is
    // what actually prevents the duplicate. Losing that race is SUCCESS, not
    // an error — the alert exists, which is all the caller wanted.
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    ) {
      const raced = await db.notification.findUnique({
        where: {
          profileId_dedupeKey: {
            profileId: input.profileId,
            dedupeKey: input.dedupeKey,
          },
        },
      });

      if (raced) {
        return { notification: raced, created: false };
      }
    }

    throw error;
  }
}

/** The default settings a profile has before it saves any of its own. */
const DEFAULT_SETTINGS = {
  isQuietHoursEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  dailyLimit: 20,
} as const;

export async function getNotificationSettings(profileId: string): Promise<{
  readonly isQuietHoursEnabled: boolean;
  readonly quietHoursStart: number | null;
  readonly quietHoursEnd: number | null;
  readonly dailyLimit: number;
}> {
  const settings = await db.notificationSettings.findUnique({
    where: { profileId },
  });

  return settings ?? DEFAULT_SETTINGS;
}

export async function saveNotificationSettings(
  profileId: string,
  input: {
    isQuietHoursEnabled: boolean;
    quietHoursStart?: number;
    quietHoursEnd?: number;
    dailyLimit: number;
  },
): Promise<NotificationSettings> {
  const fields = {
    isQuietHoursEnabled: input.isQuietHoursEnabled,
    quietHoursStart: input.quietHoursStart ?? null,
    quietHoursEnd: input.quietHoursEnd ?? null,
    dailyLimit: input.dailyLimit,
  };

  return db.notificationSettings.upsert({
    where: { profileId },
    create: { profileId, ...fields },
    update: fields,
  });
}

/**
 * Whether a kind/channel is enabled for a profile.
 *
 * ABSENCE of a row means ENABLED. A notification kind introduced in a later
 * phase must not arrive silently switched off for every existing user.
 */
export async function isChannelEnabled(
  profileId: string,
  kind: NotificationKind,
  channel: NotificationChannel,
): Promise<boolean> {
  const preference = await db.notificationPreference.findUnique({
    where: {
      profileId_kind_channel: { profileId, kind, channel },
    },
  });

  return preference?.isEnabled ?? true;
}

export async function setNotificationPreference(
  profileId: string,
  kind: NotificationKind,
  channel: NotificationChannel,
  isEnabled: boolean,
) {
  return db.notificationPreference.upsert({
    where: { profileId_kind_channel: { profileId, kind, channel } },
    create: { profileId, kind, channel, isEnabled },
    update: { isEnabled },
  });
}

/** Notifications already delivered today, in the profile's zone. */
export async function countSentToday(
  profile: Pick<Profile, "id" | "timeZone">,
  now: Date,
): Promise<number> {
  return db.notification.count({
    where: {
      profileId: profile.id,
      status: "SENT",
      sentAt: { gte: startOfLocalDay(now, profile.timeZone) },
    },
  });
}

/**
 * Decides whether a pending notification may go out now.
 *
 * Combines the per-kind preference, quiet hours and the daily limit. A held
 * notification stays PENDING and is retried on the next sweep — it is never
 * dropped, because a silenced reminder that never arrives is worse than a
 * late one.
 */
export async function evaluateDelivery(
  profile: Pick<Profile, "id" | "timeZone">,
  notification: Pick<Notification, "kind" | "channel">,
  now: Date,
  options: { isUrgent?: boolean } = {},
): Promise<
  { readonly allow: true } | { readonly allow: false; readonly reason: string }
> {
  const enabled = await isChannelEnabled(
    profile.id,
    notification.kind,
    notification.channel,
  );

  if (!enabled) {
    return { allow: false, reason: "CHANNEL_DISABLED" };
  }

  const [settings, sentToday] = await Promise.all([
    getNotificationSettings(profile.id),
    countSentToday(profile, now),
  ]);

  const quiet: QuietHours = {
    isEnabled: settings.isQuietHoursEnabled,
    startMinute: settings.quietHoursStart,
    endMinute: settings.quietHoursEnd,
  };

  const minuteOfDay = Math.round(
    (now.getTime() - startOfLocalDay(now, profile.timeZone).getTime()) / 60_000,
  );

  const decision = shouldDeliver({
    isUrgent: options.isUrgent ?? false,
    minuteOfDay,
    quiet,
    sentToday,
    dailyLimit: settings.dailyLimit,
  });

  return decision.allow
    ? { allow: true }
    : { allow: false, reason: decision.reason };
}

/** Marks a notification delivered. */
export async function markSent(notificationId: string): Promise<void> {
  await db.notification.update({
    where: { id: notificationId },
    data: { status: "SENT", sentAt: new Date() },
  });
}

/**
 * Records a failed delivery.
 *
 * After `MAX_ATTEMPTS` the notification is marked FAILED rather than retried
 * forever — an endlessly retrying send would fill the queue and hide real
 * failures behind noise.
 */
export async function markFailed(
  notificationId: string,
  error: string,
): Promise<void> {
  const notification = await db.notification.findUnique({
    where: { id: notificationId },
    select: { attempts: true },
  });

  const attempts = (notification?.attempts ?? 0) + 1;

  await db.notification.update({
    where: { id: notificationId },
    data: {
      attempts,
      // Truncated: an upstream error body must not become an unbounded column.
      lastError: error.slice(0, 500),
      status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
    },
  });

  log.warn("Notification delivery failed", { notificationId, attempts });
}

export const MAX_ATTEMPTS = 5;

export async function markRead(
  profileId: string,
  notificationId: string,
): Promise<void> {
  const existing = await db.notification.findFirst({
    where: { id: notificationId, profileId },
    select: { id: true },
  });

  if (!existing) {
    throw notFound("Notification");
  }

  await db.notification.update({
    where: { id: existing.id },
    data: { status: "READ", readAt: new Date() },
  });
}

export async function markAllRead(
  profileId: string,
  notificationIds: readonly string[] = [],
): Promise<number> {
  const where: Prisma.NotificationWhereInput = {
    profileId,
    readAt: null,
    ...(notificationIds.length > 0 ? { id: { in: [...notificationIds] } } : {}),
  };

  const result = await db.notification.updateMany({
    where,
    data: { status: "READ", readAt: new Date() },
  });

  return result.count;
}

export async function dismissNotification(
  profileId: string,
  notificationId: string,
): Promise<void> {
  const existing = await db.notification.findFirst({
    where: { id: notificationId, profileId },
    select: { id: true },
  });

  if (!existing) {
    throw notFound("Notification");
  }

  await db.notification.update({
    where: { id: existing.id },
    data: { status: "DISMISSED", readAt: new Date() },
  });
}

/** Unread count for the header badge. */
export async function countUnread(profileId: string): Promise<number> {
  return db.notification.count({
    where: { profileId, readAt: null, status: { in: ["PENDING", "SENT"] } },
  });
}

/** A dedupe key that is stable for one local day. */
export function dailyDedupeKey(
  parts: readonly (string | number)[],
  now: Date,
  timeZone: string,
): string {
  return buildDedupeKey([...parts, localDateKey(now, timeZone)]);
}
