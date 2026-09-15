import { afterAll, beforeEach, describe, expect, test } from "vitest";

import type { Profile } from "@/generated/prisma/client";
import { instantFromLocalTime } from "@/lib/time";
import { db } from "@/server/db";
import { buildIntelligenceReport } from "@/services/intelligence/intelligence.query";
import { runProactiveScan } from "@/services/intelligence/proactive.service";
import { saveNotificationSettings } from "@/services/schedule/notification.service";
import { createTask } from "@/services/task/task.service";
import { createProject, createWorkspace } from "@/services/work/work.service";
import {
  cleanupTestData,
  createTestProfile,
  disconnect,
  TEST_TIME_ZONE,
} from "./helpers";

/**
 * Proactive intelligence against a real database.
 *
 * The most important assertions here are the NEGATIVE ones: that a new
 * account is told nothing, that a thin sample produces no pattern, and that
 * the scan interrupts at most once a day. A system that speaks up when it
 * does not know something is worse than one that says nothing.
 */

let profile: Profile;
let other: Profile;

/** 2026-09-15, 10:00 in Kolkata (a Tuesday) — inside the scan window. */
const NOW = instantFromLocalTime(2026, 9, 15, 10 * 60, TEST_TIME_ZONE);

beforeEach(async () => {
  await cleanupTestData();
  profile = await createTestProfile();
  other = await createTestProfile();
});

afterAll(async () => {
  await cleanupTestData();
  await disconnect();
});

describe("a brand-new account", () => {
  test("is told nothing at all", async () => {
    const report = await buildIntelligenceReport(profile, NOW);

    expect(report.isQuiet).toBe(true);
    expect(report.insights).toHaveLength(0);
    expect(report.forgotten).toHaveLength(0);
    expect(report.patterns).toHaveLength(0);
    expect(report.deadlineRisks).toHaveLength(0);
  });

  test("gets NO life score rather than a default", async () => {
    const report = await buildIntelligenceReport(profile, NOW);

    // A default 50 "to have something to show" would be an invented, daily,
    // quantified judgement of someone's life.
    expect(report.lifeScore.overall).toBeNull();
    expect(report.lifeScore.note).toContain("Not enough is tracked");
  });

  test("the time audit says nothing was logged, not that nothing happened", async () => {
    const report = await buildIntelligenceReport(profile, NOW);

    expect(report.timeAudit.isEmpty).toBe(true);
    expect(report.timeAudit.totalMinutes).toBe(0);
  });
});

describe("forgotten items", () => {
  test("something genuinely stale is surfaced with its evidence", async () => {
    const task = await createTask(profile.id, profile.timeZone, {
      title: "[TEST] Long forgotten",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    } as never);

    // Age it past the threshold.
    await db.task.update({
      where: { id: task.id },
      data: { updatedAt: new Date(NOW.getTime() - 45 * 86_400_000) },
    });

    const report = await buildIntelligenceReport(profile, NOW);

    expect(report.forgotten).toHaveLength(1);
    expect(report.forgotten[0]?.evidence).toContain("45 days");
  });

  test("a recent task is left alone", async () => {
    await createTask(profile.id, profile.timeZone, {
      title: "[TEST] Fresh",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    } as never);

    expect(
      (await buildIntelligenceReport(profile, NOW)).forgotten,
    ).toHaveLength(0);
  });

  test("a task with a due date is scheduled, not forgotten", async () => {
    const task = await createTask(profile.id, profile.timeZone, {
      title: "[TEST] Has a date",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
      dueDate: "2026-12-01",
    } as never);

    await db.task.update({
      where: { id: task.id },
      data: { updatedAt: new Date(NOW.getTime() - 60 * 86_400_000) },
    });

    expect(
      (await buildIntelligenceReport(profile, NOW)).forgotten,
    ).toHaveLength(0);
  });
});

describe("deadline risk", () => {
  test("a project that cannot be finished is reported with arithmetic", async () => {
    const workspace = await createWorkspace(profile.id, {
      name: "[TEST] Work",
      type: "FREELANCE",
    } as never);

    const project = await createProject(profile.id, profile.timeZone, {
      workspaceId: workspace.id,
      name: "[TEST] Impossible project",
      status: "ACTIVE",
      priority: "HIGH",
      targetEndDate: "2026-09-16",
    } as never);

    // 40 open tasks × 30 minutes = 20 hours, due tomorrow.
    await db.task.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        profileId: profile.id,
        projectId: project.id,
        title: `[TEST] Task ${index}`,
        position: index,
      })),
    });

    const report = await buildIntelligenceReport(profile, NOW);

    expect(report.deadlineRisks).toHaveLength(1);
    expect(report.deadlineRisks[0]?.level).toBe("IMPOSSIBLE");
    // The claim carries the numbers behind it.
    expect(report.deadlineRisks[0]?.evidence).toContain("h of work");
  });

  test("a comfortable project is not flagged", async () => {
    const workspace = await createWorkspace(profile.id, {
      name: "[TEST] Work",
      type: "FREELANCE",
    } as never);

    await createProject(profile.id, profile.timeZone, {
      workspaceId: workspace.id,
      name: "[TEST] Relaxed project",
      status: "ACTIVE",
      priority: "LOW",
      targetEndDate: "2026-12-31",
    } as never);

    expect(
      (await buildIntelligenceReport(profile, NOW)).deadlineRisks,
    ).toHaveLength(0);
  });
});

describe("behaviour patterns", () => {
  test("SAYS NOTHING with a thin sample", async () => {
    // Five completions is not a pattern; claiming otherwise is astrology.
    for (let index = 0; index < 5; index += 1) {
      const task = await createTask(profile.id, profile.timeZone, {
        title: `[TEST] Done ${index}`,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
      } as never);

      await db.task.update({
        where: { id: task.id },
        data: { status: "COMPLETED", completedAt: NOW },
      });
    }

    expect((await buildIntelligenceReport(profile, NOW)).patterns).toHaveLength(
      0,
    );
  });

  test("finds a real pattern once there is enough data", async () => {
    // 24 completions, heavily skewed to one weekday.
    const mondayish = instantFromLocalTime(
      2026,
      9,
      14,
      12 * 60,
      TEST_TIME_ZONE,
    );
    const tuesdayish = instantFromLocalTime(
      2026,
      9,
      8,
      12 * 60,
      TEST_TIME_ZONE,
    );

    for (let index = 0; index < 24; index += 1) {
      const task = await createTask(profile.id, profile.timeZone, {
        title: `[TEST] Done ${index}`,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
      } as never);

      await db.task.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          completedAt: index < 18 ? mondayish : tuesdayish,
        },
      });
    }

    const report = await buildIntelligenceReport(profile, NOW);
    const best = report.patterns.find((p) => p.kind === "BEST_DAY");

    expect(best).toBeDefined();
    expect(best?.evidence).toContain("24 completions");
  });
});

describe("the proactive scan", () => {
  /** Creates a profile whose data guarantees at least one URGENT insight. */
  async function makeUrgentSituation(target: Profile) {
    const workspace = await createWorkspace(target.id, {
      name: "[TEST] Work",
      type: "FREELANCE",
    } as never);

    const project = await createProject(target.id, target.timeZone, {
      workspaceId: workspace.id,
      name: "[TEST] Doomed",
      status: "ACTIVE",
      priority: "URGENT",
      targetEndDate: "2026-09-16",
    } as never);

    await db.task.createMany({
      data: Array.from({ length: 40 }, (_, index) => ({
        profileId: target.id,
        projectId: project.id,
        title: `[TEST] Task ${index}`,
        position: index,
      })),
    });
  }

  test("says nothing when there is nothing to say", async () => {
    const result = await runProactiveScan(NOW);

    expect(result.insightsFound).toBe(0);
    expect(result.notificationsCreated).toBe(0);
    expect(await db.notification.count({ where: { kind: "PROACTIVE" } })).toBe(
      0,
    );
  });

  test("creates a notification carrying the evidence", async () => {
    await makeUrgentSituation(profile);

    const result = await runProactiveScan(NOW);

    expect(result.notificationsCreated).toBeGreaterThan(0);

    const notification = await db.notification.findFirstOrThrow({
      where: { profileId: profile.id, kind: "PROACTIVE" },
    });

    // A proactive alert without its numbers is an assertion the user cannot
    // check.
    expect(notification.body).toContain("h of work");
  });

  test("interrupts AT MOST ONCE PER LOCAL DAY", async () => {
    await makeUrgentSituation(profile);

    const first = await runProactiveScan(NOW);
    const second = await runProactiveScan(new Date(NOW.getTime() + 60_000));

    expect(first.notificationsCreated).toBeGreaterThan(0);
    // The second scan skipped the profile entirely.
    expect(second.notificationsCreated).toBe(0);
    expect(second.profilesSkipped).toBeGreaterThan(0);
  });

  test("is skipped outside waking hours", async () => {
    await makeUrgentSituation(profile);

    // 03:00 local.
    const night = instantFromLocalTime(2026, 9, 15, 3 * 60, TEST_TIME_ZONE);
    const result = await runProactiveScan(night);

    expect(result.profilesExamined).toBe(0);
    expect(result.notificationsCreated).toBe(0);
  });

  test("proactive alerts NEVER override quiet hours", async () => {
    await makeUrgentSituation(profile);

    // Quiet all day — a deliberate, extreme setting.
    await saveNotificationSettings(profile.id, {
      isQuietHoursEnabled: true,
      quietHoursStart: 0,
      quietHoursEnd: 23 * 60 + 59,
      dailyLimit: 20,
    });

    const result = await runProactiveScan(NOW);

    // The insight is recorded but NOT delivered. The user did not ask for it,
    // so it does not get to override their silence.
    expect(result.notificationsCreated).toBeGreaterThan(0);
    expect(result.notificationsDelivered).toBe(0);

    const notification = await db.notification.findFirstOrThrow({
      where: { profileId: profile.id, kind: "PROACTIVE" },
    });
    expect(notification.status).toBe("PENDING");
  });

  test("respects a disabled PROACTIVE channel", async () => {
    await makeUrgentSituation(profile);

    await db.notificationPreference.create({
      data: {
        profileId: profile.id,
        kind: "PROACTIVE",
        channel: "IN_APP",
        isEnabled: false,
      },
    });

    const result = await runProactiveScan(NOW);

    expect(result.notificationsDelivered).toBe(0);
  });

  test("isolates a failure to one profile", async () => {
    await makeUrgentSituation(profile);
    await makeUrgentSituation(other);

    const result = await runProactiveScan(NOW);

    // Both profiles examined; neither blocked the other.
    expect(result.profilesExamined).toBe(2);
    expect(result.failures).toBe(0);
  });

  test("each profile receives only its OWN insights", async () => {
    await makeUrgentSituation(profile);

    await runProactiveScan(NOW);

    const mine = await db.notification.count({
      where: { profileId: profile.id, kind: "PROACTIVE" },
    });
    const theirs = await db.notification.count({
      where: { profileId: other.id, kind: "PROACTIVE" },
    });

    expect(mine).toBeGreaterThan(0);
    expect(theirs).toBe(0);
  });
});

describe("cross-user isolation", () => {
  test("another user's stale tasks never appear in this report", async () => {
    const theirTask = await createTask(other.id, other.timeZone, {
      title: "[TEST] Their forgotten thing",
      priority: "MEDIUM",
      category: "PERSONAL",
      energy: "MEDIUM",
    } as never);

    await db.task.update({
      where: { id: theirTask.id },
      data: { updatedAt: new Date(NOW.getTime() - 90 * 86_400_000) },
    });

    const report = await buildIntelligenceReport(profile, NOW);

    expect(report.forgotten).toHaveLength(0);
    expect(JSON.stringify(report)).not.toContain("Their forgotten thing");
  });

  test("another user's completions do not create this user's patterns", async () => {
    const when = instantFromLocalTime(2026, 9, 14, 12 * 60, TEST_TIME_ZONE);

    for (let index = 0; index < 30; index += 1) {
      const task = await createTask(other.id, other.timeZone, {
        title: `[TEST] Theirs ${index}`,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
      } as never);

      await db.task.update({
        where: { id: task.id },
        data: { status: "COMPLETED", completedAt: when },
      });
    }

    expect((await buildIntelligenceReport(profile, NOW)).patterns).toHaveLength(
      0,
    );
  });

  test("the life score is computed per profile", async () => {
    // Give the other profile plenty of data.
    for (let index = 0; index < 10; index += 1) {
      const task = await createTask(other.id, other.timeZone, {
        title: `[TEST] Theirs ${index}`,
        priority: "MEDIUM",
        category: "PERSONAL",
        energy: "MEDIUM",
        dueDate: "2026-09-15",
      } as never);

      await db.task.update({
        where: { id: task.id },
        data: { status: "COMPLETED", completedAt: NOW },
      });
    }

    // This profile still has nothing, so still has no score.
    expect(
      (await buildIntelligenceReport(profile, NOW)).lifeScore.overall,
    ).toBeNull();
  });
});
