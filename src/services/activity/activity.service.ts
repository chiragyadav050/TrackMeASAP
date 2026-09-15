import "server-only";

import type { ActivityAction, Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

/**
 * Append-only activity log.
 *
 * Phase 2 writes it; no UI reads it yet. It exists now because history cannot
 * be reconstructed after the fact — Phase 8's assistant needs to answer "what
 * happened this week", and Phase 10 needs drift detection. Both require
 * events to have been recorded from the beginning.
 *
 * Two rules:
 *
 *  1. **Metadata stays small and non-sensitive.** Changed field NAMES and
 *     coarse values only. Never a full entity snapshot, never task notes —
 *     the log would otherwise become a second, unguarded copy of the user's
 *     private content.
 *
 *  2. **Logging never breaks the mutation it describes.** A failed audit
 *     write is logged and swallowed. Losing an audit row is regrettable;
 *     failing the user's task completion because of it is worse.
 */

const log = logger.child({ service: "activity" });

export const ENTITY_TASK = "task";
export const ENTITY_SUBTASK = "subtask";

export type RecordActivityInput = {
  readonly profileId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: ActivityAction;
  readonly metadata?: Prisma.InputJsonValue;
};

export async function recordActivity(
  input: RecordActivityInput,
): Promise<void> {
  try {
    await db.activityEvent.create({
      data: {
        profileId: input.profileId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    });
  } catch (error) {
    log.warn("Could not record activity event", {
      entityType: input.entityType,
      action: input.action,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Batched variant for bulk operations, so a 100-task update writes one
 * statement instead of a hundred.
 */
export async function recordActivityBatch(
  events: readonly RecordActivityInput[],
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  try {
    await db.activityEvent.createMany({
      data: events.map((event) => ({
        profileId: event.profileId,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
      })),
    });
  } catch (error) {
    log.warn("Could not record activity batch", {
      count: events.length,
      detail: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Field names that changed, for the `UPDATED` event's metadata.
 *
 * Names only — the values themselves are the user's content and do not belong
 * in an audit row.
 */
export function changedFieldNames(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter((key) => {
    const previous = before[key];
    const next = after[key];

    if (previous instanceof Date && next instanceof Date) {
      return previous.getTime() !== next.getTime();
    }

    return previous !== next;
  });
}
