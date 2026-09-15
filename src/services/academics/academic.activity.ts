import "server-only";

import type { ActivityAction, Prisma } from "@/generated/prisma/client";
import { recordActivity } from "@/services/activity/activity.service";

/**
 * Academic entity names for the Phase 2 activity log.
 *
 * `ActivityEvent.entityType` is a plain string precisely so a new module can
 * log against its own entities without migrating that table — this is that
 * mechanism being used for the first time.
 *
 * The same two rules apply as everywhere else in the log: metadata stays
 * small and non-sensitive (field names and coarse values, never a snapshot or
 * a student's notes), and a failed audit write never breaks the mutation it
 * describes.
 */

export const ENTITY_SEMESTER = "semester";
export const ENTITY_SUBJECT = "subject";
export const ENTITY_CLASS_SESSION = "class_session";
export const ENTITY_ATTENDANCE = "attendance";
export const ENTITY_ASSIGNMENT = "assignment";
export const ENTITY_ASSESSMENT = "assessment";
export const ENTITY_EXAM = "exam";
export const ENTITY_EXAM_TOPIC = "exam_topic";
export const ENTITY_STUDY_SESSION = "study_session";
export const ENTITY_ACADEMIC_NOTE = "academic_note";

export async function recordAcademicActivity(
  profileId: string,
  entityType: string,
  entityId: string,
  action: ActivityAction,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await recordActivity({
    profileId,
    entityType,
    entityId,
    action,
    ...(metadata === undefined ? {} : { metadata }),
  });
}
