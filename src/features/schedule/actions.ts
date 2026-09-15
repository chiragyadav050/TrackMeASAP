"use server";

import { revalidatePath } from "next/cache";

import {
  createAuthenticatedAction,
  createAuthenticatedCommand,
} from "@/server/action";
import {
  createEventSchema,
  createReminderSchema,
  eventIdSchema,
  freeTimeSchema,
  markNotificationsReadSchema,
  notificationIdSchema,
  notificationPreferenceSchema,
  notificationSettingsSchema,
  reminderIdSchema,
  setReminderStatusSchema,
  snoozeReminderSchema,
  updateEventSchema,
  updateReminderSchema,
} from "@/services/schedule/schedule.schema";
import {
  createEvent,
  deleteEvent,
  setEventCancelled,
  updateEvent,
} from "@/services/schedule/calendar.service";
import {
  createReminder,
  deleteReminder,
  setReminderStatus,
  snoozeReminder,
  updateReminder,
} from "@/services/schedule/reminder.service";
import {
  dismissNotification,
  markAllRead,
  markRead,
  saveNotificationSettings,
  setNotificationPreference,
} from "@/services/schedule/notification.service";
import { getFreeTime } from "@/services/schedule/calendar.query";
import type { FreeSlotDto } from "@/types/schedule";
import { z } from "zod";

/**
 * Schedule server actions.
 *
 * Same two factories as every earlier phase. Identity comes from the Clerk
 * session — no action accepts a profile id, and none reaches the database
 * except through a service that requires one.
 */

function revalidateSchedule(): void {
  revalidatePath("/calendar", "layout");
  revalidatePath("/today");
  revalidatePath("/overview");
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const createReminderAction = createAuthenticatedAction({
  name: "reminder.create",
  schema: createReminderSchema,
  handler: async (input, { profile }): Promise<{ reminderId: string }> => {
    const reminder = await createReminder(profile.id, profile.timeZone, input);
    revalidateSchedule();
    return { reminderId: reminder.id };
  },
});

export const updateReminderAction = createAuthenticatedAction({
  name: "reminder.update",
  schema: updateReminderSchema,
  handler: async (input, { profile }): Promise<{ reminderId: string }> => {
    await updateReminder(profile.id, profile.timeZone, input);
    revalidateSchedule();
    return { reminderId: input.reminderId };
  },
});

/**
 * Snoozes a reminder by N minutes.
 *
 * The target instant is computed on the SERVER from the current time — a
 * browser with a wrong clock must not be able to schedule into the past.
 */
export const snoozeReminderCommand = createAuthenticatedCommand({
  name: "reminder.snooze",
  schema: snoozeReminderSchema,
  handler: async (input, { profile }): Promise<{ reminderId: string }> => {
    await snoozeReminder(profile.id, input.reminderId, input.minutes);
    revalidateSchedule();
    return { reminderId: input.reminderId };
  },
});

export const setReminderStatusCommand = createAuthenticatedCommand({
  name: "reminder.setStatus",
  schema: setReminderStatusSchema,
  handler: async (input, { profile }): Promise<{ reminderId: string }> => {
    await setReminderStatus(profile.id, input.reminderId, input.status);
    revalidateSchedule();
    return { reminderId: input.reminderId };
  },
});

export const deleteReminderCommand = createAuthenticatedCommand({
  name: "reminder.delete",
  schema: reminderIdSchema,
  handler: async (input, { profile }): Promise<{ reminderId: string }> => {
    await deleteReminder(profile.id, input.reminderId);
    revalidateSchedule();
    return { reminderId: input.reminderId };
  },
});

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

export const createEventAction = createAuthenticatedAction({
  name: "event.create",
  schema: createEventSchema,
  handler: async (input, { profile }): Promise<{ eventId: string }> => {
    const event = await createEvent(profile.id, profile.timeZone, input);
    revalidateSchedule();
    return { eventId: event.id };
  },
});

export const updateEventAction = createAuthenticatedAction({
  name: "event.update",
  schema: updateEventSchema,
  handler: async (input, { profile }): Promise<{ eventId: string }> => {
    await updateEvent(profile.id, profile.timeZone, input);
    revalidateSchedule();
    return { eventId: input.eventId };
  },
});

/**
 * Cancels or restores an event.
 *
 * Offered before deletion: a cancelled class is still information, and
 * Life OS never silently discards something a user might need.
 */
export const setEventCancelledCommand = createAuthenticatedCommand({
  name: "event.setCancelled",
  schema: z.object({
    eventId: z.string().min(1),
    isCancelled: z.boolean(),
  }),
  handler: async (input, { profile }): Promise<{ eventId: string }> => {
    await setEventCancelled(profile.id, input.eventId, input.isCancelled);
    revalidateSchedule();
    return { eventId: input.eventId };
  },
});

export const deleteEventCommand = createAuthenticatedCommand({
  name: "event.delete",
  schema: eventIdSchema,
  handler: async (input, { profile }): Promise<{ eventId: string }> => {
    await deleteEvent(profile.id, input.eventId);
    revalidateSchedule();
    return { eventId: input.eventId };
  },
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const markNotificationReadCommand = createAuthenticatedCommand({
  name: "notification.markRead",
  schema: notificationIdSchema,
  handler: async (input, { profile }): Promise<{ notificationId: string }> => {
    await markRead(profile.id, input.notificationId);
    revalidateSchedule();
    return { notificationId: input.notificationId };
  },
});

export const markAllNotificationsReadCommand = createAuthenticatedCommand({
  name: "notification.markAllRead",
  schema: markNotificationsReadSchema,
  handler: async (input, { profile }): Promise<{ count: number }> => {
    const count = await markAllRead(profile.id, input.notificationIds);
    revalidateSchedule();
    return { count };
  },
});

export const dismissNotificationCommand = createAuthenticatedCommand({
  name: "notification.dismiss",
  schema: notificationIdSchema,
  handler: async (input, { profile }): Promise<{ notificationId: string }> => {
    await dismissNotification(profile.id, input.notificationId);
    revalidateSchedule();
    return { notificationId: input.notificationId };
  },
});

export const setNotificationPreferenceCommand = createAuthenticatedCommand({
  name: "notification.setPreference",
  schema: notificationPreferenceSchema,
  handler: async (input, { profile }): Promise<{ kind: string }> => {
    await setNotificationPreference(
      profile.id,
      input.kind,
      input.channel,
      input.isEnabled,
    );
    revalidatePath("/settings");
    return { kind: input.kind };
  },
});

export const saveNotificationSettingsAction = createAuthenticatedAction({
  name: "notification.saveSettings",
  schema: notificationSettingsSchema,
  handler: async (input, { profile }): Promise<{ saved: true }> => {
    await saveNotificationSettings(profile.id, input);
    revalidatePath("/settings");
    return { saved: true };
  },
});

// ---------------------------------------------------------------------------
// Reads that need to be callable from the client
// ---------------------------------------------------------------------------

/** Usable gaps on one day, for the "when could I do this?" panel. */
export const getFreeTimeCommand = createAuthenticatedCommand({
  name: "calendar.freeTime",
  schema: freeTimeSchema,
  handler: async (input, { profile }): Promise<readonly FreeSlotDto[]> =>
    getFreeTime(profile, input.date, input.minimumMinutes),
});
