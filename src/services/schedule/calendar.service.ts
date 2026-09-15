import "server-only";

import type { CalendarEvent, Prisma } from "@/generated/prisma/client";
import { notFound } from "@/lib/errors";
import { db } from "@/server/db";
import {
  fromDateOnly,
  toDateOnly,
  toInstant,
} from "@/services/academics/academic.dates";
import { recordActivity } from "@/services/activity/activity.service";
import type { z } from "zod";
import type {
  CreateEventInput,
  updateEventSchema,
} from "@/services/schedule/schedule.schema";

/**
 * Calendar event mutations.
 *
 * All-day events anchor at local midnight with an EXCLUSIVE end: an event
 * "Monday to Wednesday" ends at local midnight on Thursday. That is what
 * makes it three days rather than two-and-a-bit, and it makes overlap
 * arithmetic work without special-casing all-day blocks.
 */

export const ENTITY_EVENT = "calendar_event";

export async function requireOwnedEvent(
  profileId: string,
  eventId: string,
): Promise<CalendarEvent> {
  const event = await db.calendarEvent.findFirst({
    where: { id: eventId, profileId },
  });

  if (!event) {
    throw notFound("Event");
  }

  return event;
}

/** Resolves the user's date/time fields into an absolute start and end. */
function resolveWindow(
  input: {
    startDate: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
    isAllDay?: boolean;
  },
  timeZone: string,
): { startAt: Date; endAt: Date; isAllDay: boolean } {
  const isAllDay = input.isAllDay ?? false;

  if (isAllDay) {
    const endKey = input.endDate ?? input.startDate;
    const exclusiveEnd = toDateOnly(endKey);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);

    return {
      startAt: toInstant(input.startDate, undefined, timeZone),
      endAt: toInstant(fromDateOnly(exclusiveEnd), undefined, timeZone),
      isAllDay: true,
    };
  }

  const startAt = toInstant(input.startDate, input.startTime, timeZone);
  const endAt = toInstant(
    input.endDate ?? input.startDate,
    input.endTime,
    timeZone,
  );

  // A timed event with no end time defaults to an hour: a zero-length block
  // would vanish from every calendar view and never conflict with anything.
  return {
    startAt,
    endAt:
      endAt.getTime() > startAt.getTime()
        ? endAt
        : new Date(startAt.getTime() + DEFAULT_EVENT_MINUTES * 60_000),
    isAllDay: false,
  };
}

const DEFAULT_EVENT_MINUTES = 60;

export async function createEvent(
  profileId: string,
  timeZone: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const window = resolveWindow(input, timeZone);

  const event = await db.calendarEvent.create({
    data: {
      profileId,
      title: input.title,
      description: input.description ?? null,
      location: input.location ?? null,
      kind: input.kind,
      startAt: window.startAt,
      endAt: window.endAt,
      isAllDay: window.isAllDay,
      isBusy: input.isBusy,
      colorKey: input.colorKey ?? null,
    },
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_EVENT,
    entityId: event.id,
    action: "CREATED",
  });

  return event;
}

export async function updateEvent(
  profileId: string,
  timeZone: string,
  input: z.infer<typeof updateEventSchema>,
): Promise<CalendarEvent> {
  const existing = await requireOwnedEvent(profileId, input.eventId);

  const data: Prisma.CalendarEventUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) {
    data.description = input.description ?? null;
  }
  if (input.location !== undefined) data.location = input.location ?? null;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.isBusy !== undefined) data.isBusy = input.isBusy;
  if (input.colorKey !== undefined) data.colorKey = input.colorKey ?? null;

  if (input.startDate) {
    const window = resolveWindow(
      {
        startDate: input.startDate,
        startTime: input.startTime,
        endDate: input.endDate,
        endTime: input.endTime,
        isAllDay: input.isAllDay ?? existing.isAllDay,
      },
      timeZone,
    );

    data.startAt = window.startAt;
    data.endAt = window.endAt;
    data.isAllDay = window.isAllDay;
  }

  const event = await db.calendarEvent.update({
    where: { id: existing.id },
    data,
  });

  await recordActivity({
    profileId,
    entityType: ENTITY_EVENT,
    entityId: event.id,
    action: "UPDATED",
  });

  return event;
}

/**
 * Cancels an event without destroying it.
 *
 * Offered before deletion because a cancelled class or meeting is still
 * information — "this was going to happen and did not" is different from it
 * never having existed.
 */
export async function setEventCancelled(
  profileId: string,
  eventId: string,
  isCancelled: boolean,
): Promise<CalendarEvent> {
  const existing = await requireOwnedEvent(profileId, eventId);

  return db.calendarEvent.update({
    where: { id: existing.id },
    data: { cancelledAt: isCancelled ? new Date() : null },
  });
}

export async function deleteEvent(
  profileId: string,
  eventId: string,
): Promise<void> {
  const existing = await requireOwnedEvent(profileId, eventId);

  // Reminders pointing at it survive with `eventId` null — a reminder about a
  // deleted meeting may still be the thing the user needs to see.
  await db.calendarEvent.delete({ where: { id: existing.id } });

  await recordActivity({
    profileId,
    entityType: ENTITY_EVENT,
    entityId: existing.id,
    action: "DELETED",
    metadata: { title: existing.title.slice(0, 60) },
  });
}
