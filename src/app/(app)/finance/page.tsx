import type { Metadata } from "next";

import { FinanceBoard } from "@/features/life/components/finance-board";
import { localDateKey } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import {
  getMoneySummary,
  listMoneyEntries,
  listSubscriptions,
} from "@/services/life/money.query";
import { moneyFiltersSchema } from "@/services/life/life.schema";

export const metadata: Metadata = {
  title: "Finance",
};

/**
 * Filters arrive as search params and are parsed with the SAME Zod schema the
 * actions use, so a hand-edited URL falls back to defaults rather than
 * reaching the query layer unvalidated.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireProfileForPage();
  const params = await searchParams;

  const parsed = moneyFiltersSchema.safeParse({
    month: params.month,
    direction: params.direction,
    categoryId: params.categoryId,
    search: params.search,
  });

  const filters = parsed.success ? parsed.data : moneyFiltersSchema.parse({});
  const now = new Date();

  const [summary, entries, subscriptions] = await Promise.all([
    getMoneySummary(profile, filters.month, now),
    listMoneyEntries(profile, filters, now),
    listSubscriptions(profile, false, now),
  ]);

  return (
    <FinanceBoard
      summary={summary}
      entries={entries}
      subscriptions={subscriptions}
      todayKey={localDateKey(now, profile.timeZone)}
    />
  );
}
