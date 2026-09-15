import "dotenv/config";

import { db } from "@/server/db";
import { proactiveScan, sweepReminders } from "@/server/jobs";
import { flushPendingNotifications } from "@/services/schedule/reminder.service";

/**
 * Runs one sweep and exits: `pnpm worker:once`.
 *
 * Exists so reminder delivery can be verified — and operated — WITHOUT Redis.
 * The sweep is the same function the queued worker calls, so this is a real
 * test of the real path, not a parallel implementation that could drift.
 */
async function main(): Promise<void> {
  const sweep = await sweepReminders();
  const flush = await flushPendingNotifications();
  const scan = await proactiveScan();

  // Deliberately `console` rather than the structured logger: this is a CLI
  // whose entire output is meant for a human reading a terminal, and routing
  // it through the JSON logger would bury the result in envelope fields.
  // eslint-disable-next-line no-console -- CLI output, not application logging
  console.log(JSON.stringify({ sweep, flush, scan }, null, 2));

  await db.$disconnect();
}

void main();
