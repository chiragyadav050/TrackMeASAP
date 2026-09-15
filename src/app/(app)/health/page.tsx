import type { Metadata } from "next";

import { HealthBoard } from "@/features/life/components/health-board";
import { formatInTimeZone, localDateKey } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import { getCheckIn, listRecentCheckIns } from "@/services/life/money.query";

export const metadata: Metadata = {
  title: "Health",
};

export default async function HealthPage() {
  const profile = await requireProfileForPage();

  // "Today" is resolved in the PROFILE's zone, never the server's.
  const now = new Date();
  const todayKey = localDateKey(now, profile.timeZone);

  const [checkIn, recent] = await Promise.all([
    getCheckIn(profile, todayKey),
    listRecentCheckIns(profile, 14, now),
  ]);

  return (
    <HealthBoard
      todayKey={todayKey}
      todayLabel={formatInTimeZone(
        now,
        profile.timeZone,
        { weekday: "long", day: "numeric", month: "long" },
        profile.locale,
      )}
      checkIn={checkIn}
      recent={recent}
    />
  );
}
