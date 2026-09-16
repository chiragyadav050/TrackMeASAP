"use client";

import { CreditCard, Plus, Trash2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Field, fieldAria } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createMoneyEntryAction,
  deleteMoneyEntryCommand,
  recordSubscriptionChargeCommand,
} from "@/features/life/actions";
import { BUDGET_META } from "@/features/life/components/life-badges";
import { cn } from "@/lib/utils";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type {
  MoneyEntryDto,
  MoneySummaryDto,
  SubscriptionDto,
} from "@/types/life";

/**
 * The finance page.
 *
 * Every figure here is a sum of entries the user typed. Nothing is estimated,
 * categorised automatically, or projected — a personal finance screen that
 * guesses is worse than one that is merely incomplete.
 */
export function FinanceBoard({
  summary,
  entries,
  subscriptions,
  todayKey,
}: {
  summary: MoneySummaryDto;
  entries: readonly MoneyEntryDto[];
  subscriptions: readonly SubscriptionDto[];
  todayKey: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
    fallback: string,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? fallback);
        return;
      }

      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={summary.monthLabel}
        title="Finance"
        description="Where the money goes, without a spreadsheet."
        actions={
          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="size-3.5" />
            Add entry
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <figure className="rounded-xl border border-border bg-surface p-4">
          <figcaption className="text-label text-muted-foreground">
            Income
          </figcaption>
          <p className="mt-1 text-heading font-semibold text-success tabular-nums">
            {summary.incomeLabel}
          </p>
        </figure>

        <figure className="rounded-xl border border-border bg-surface p-4">
          <figcaption className="text-label text-muted-foreground">
            Spent
          </figcaption>
          <p className="mt-1 text-heading font-semibold tabular-nums">
            {summary.expenseLabel}
          </p>
        </figure>

        <figure className="rounded-xl border border-border bg-surface p-4">
          <figcaption className="text-label text-muted-foreground">
            Net
          </figcaption>
          <p
            className={cn(
              "mt-1 text-heading font-semibold tabular-nums",
              summary.netMinor < 0 ? "text-danger" : "text-success",
            )}
          >
            {summary.netLabel}
          </p>
        </figure>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="This month"
          icon={Wallet}
          className="lg:col-span-2"
          description={
            summary.entryCount === 0
              ? undefined
              : `${summary.entryCount} ${summary.entryCount === 1 ? "entry" : "entries"}`
          }
        >
          {entries.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nothing recorded this month."
              description="Add what you spend as it happens. Totals here are sums of real entries — nothing is estimated."
              action={
                <Button size="sm" onClick={() => setIsDialogOpen(true)}>
                  Add an entry
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border-subtle" aria-busy={isPending}>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="group flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-meta">{entry.description}</p>
                    <p className="text-label text-muted-foreground">
                      {entry.dateLabel}
                      {entry.categoryName ? ` · ${entry.categoryName}` : ""}
                      {entry.isFromSubscription ? " · subscription" : ""}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 text-meta font-medium tabular-nums",
                      entry.direction === "INCOME"
                        ? "text-success"
                        : "text-foreground",
                    )}
                  >
                    {entry.direction === "INCOME" ? "+" : "−"}
                    {entry.amountLabel}
                  </span>

                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${entry.description}`}
                    disabled={isPending}
                    className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() =>
                      run(
                        () => deleteMoneyEntryCommand({ entryId: entry.id }),
                        "Couldn't delete the entry.",
                      )
                    }
                  >
                    <Trash2 className="size-3.5 text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Budgets" icon={Wallet}>
            {summary.categories.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No categories yet."
                description="Categories let you set a monthly budget and see where it goes."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {summary.categories.map((category) => (
                  <li key={category.id} className="space-y-1.5 px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-meta">
                        {category.name}
                      </span>
                      <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                        {category.spentLabel}
                        {category.budgetLabel
                          ? ` / ${category.budgetLabel}`
                          : ""}
                      </span>
                    </div>

                    <p
                      className={cn(
                        "text-label",
                        BUDGET_META[category.budgetStatus].className,
                      )}
                    >
                      {BUDGET_META[category.budgetStatus].label}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Subscriptions"
            icon={CreditCard}
            description={`${summary.subscriptionMonthlyLabel} a month`}
          >
            {subscriptions.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No subscriptions tracked."
                description="Add the recurring charges you actually pay."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {subscriptions.map((subscription) => (
                  <li
                    key={subscription.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-meta">{subscription.name}</p>
                      <p className="text-label text-muted-foreground">
                        {subscription.amountLabel} ·{" "}
                        {subscription.nextChargeLabel}
                      </p>
                    </div>

                    {subscription.isDueSoon ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          run(
                            () =>
                              recordSubscriptionChargeCommand({
                                subscriptionId: subscription.id,
                              }),
                            "Couldn't record the charge.",
                          )
                        }
                      >
                        Record
                      </Button>
                    ) : (
                      <Badge variant="outline" className="shrink-0">
                        {subscription.daysUntilCharge}d
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <EntryDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        categories={summary.categories}
        currency={summary.currency}
        todayKey={todayKey}
      />
    </div>
  );
}

function EntryDialog({
  isOpen,
  onOpenChange,
  categories,
  currency,
  todayKey,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  categories: MoneySummaryDto["categories"];
  currency: string;
  todayKey: string;
}) {
  const router = useRouter();

  type EntryActionState = ActionState<{ entryId: string }>;

  const [state, formAction, isPending] = useActionState<
    EntryActionState,
    FormData
  >(createMoneyEntryAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<EntryActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Entry added.");
      onOpenChange(false);
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't add the entry.");
    }
  }, [state, onOpenChange, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add entry</DialogTitle>
          <DialogDescription>
            Amounts are stored exactly, to the paisa — totals never drift.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="currency" value={currency} />

          {state.status === "error" && fieldErrors?._form ? (
            <Alert variant="destructive">
              <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
            </Alert>
          ) : null}

          <Field
            id="description"
            label="What was it"
            errors={fieldErrors?.description}
          >
            <Input
              {...fieldAria("description", {
                hasError: Boolean(fieldErrors?.description),
              })}
              name="description"
              placeholder="Lunch"
              autoFocus
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="amount" label="Amount" errors={fieldErrors?.amount}>
              <Input
                {...fieldAria("amount", {
                  hasError: Boolean(fieldErrors?.amount),
                })}
                name="amount"
                inputMode="decimal"
                placeholder="249.50"
                required
                className="h-9"
              />
            </Field>

            <Field
              id="direction"
              label="Direction"
              errors={fieldErrors?.direction}
            >
              <NativeSelect
                {...fieldAria("direction", {})}
                name="direction"
                defaultValue="EXPENSE"
              >
                <option value="EXPENSE">Money out</option>
                <option value="INCOME">Money in</option>
              </NativeSelect>
            </Field>

            <Field id="entryDate" label="Date" errors={fieldErrors?.entryDate}>
              <Input
                {...fieldAria("entryDate", {})}
                type="date"
                name="entryDate"
                defaultValue={todayKey}
                required
                className="h-9"
              />
            </Field>

            {categories.length > 0 ? (
              <Field
                id="categoryId"
                label="Category"
                hint="Optional."
                errors={fieldErrors?.categoryId}
              >
                <NativeSelect
                  {...fieldAria("categoryId", { hasHint: true })}
                  name="categoryId"
                  defaultValue=""
                >
                  <option value="">Uncategorised</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
