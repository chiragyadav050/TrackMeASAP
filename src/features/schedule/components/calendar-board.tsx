"use client";

import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventDialog } from "@/features/schedule/components/event-dialog";
import { ReminderPanel } from "@/features/schedule/components/reminder-panel";
import { SOURCE_META } from "@/features/schedule/components/schedule-badges";
import { cn } from "@/lib/utils";
import type { CalendarViewDto, ReminderDto } from "@/types/schedule";

const VIEWS = ["DAY", "WEEK", "MONTH", "AGENDA"] as const;

const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = {
  DAY: "Day",
  WEEK: "Week",
  MONTH: "Month",
  AGENDA: "Agenda",
};

/**
 * The calendar.
 *
 * ONE TIMELINE. Classes, deadlines, exams, tasks and personal events all
 * appear together, each labelled with where it came from. Only the user's own
 * events are editable here — coursework is edited where it lives, so the
 * calendar can never hold a stale copy.
 *
 * View and date live in the URL: a particular week is something you bookmark
 * and share, and the server needs both to run the query anyway.
 */
export function CalendarBoard({
  view,
  reminders,
  todayKey,
}: {
  view: CalendarViewDto;
  reminders: readonly ReminderDto[];
  todayKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [isEventOpen, setIsEventOpen] = useState(false);

  const navigate = (params: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(params)) {
      next.set(key, value);
    }

    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}` as never, {
        scroll: false,
      });
    });
  };

  /** Steps the anchor by one whole view-width. */
  const step = (direction: -1 | 1) => {
    const days = view.view === "DAY" ? 1 : view.view === "MONTH" ? 30 : 7;

    const anchor = new Date(`${view.anchorKey}T00:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() + direction * days);

    navigate({ date: anchor.toISOString().slice(0, 10) });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={view.rangeLabel}
        title="Calendar"
        description="Classes, deadlines, work blocks and reminders on one timeline."
        actions={
          <Button size="sm" onClick={() => setIsEventOpen(true)}>
            <Plus className="size-3.5" />
            New event
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Previous period"
            onClick={() => step(-1)}
          >
            <ChevronLeft className="size-4" />
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ date: todayKey })}
          >
            Today
          </Button>

          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Next period"
            onClick={() => step(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Calendar view"
        >
          {VIEWS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view.view === option ? "secondary" : "ghost"}
              aria-pressed={view.view === option}
              onClick={() => navigate({ view: option })}
            >
              {VIEW_LABELS[option]}
            </Button>
          ))}
        </div>
      </div>

      {view.conflicts.length > 0 ? (
        <SectionCard
          title="Overlapping commitments"
          icon={AlertTriangle}
          description="Two things booked at once. Deadlines are excluded — only blocks that occupy real time count."
        >
          <ul className="divide-y divide-border-subtle">
            {view.conflicts.map((conflict) => (
              <li
                key={`${conflict.firstId}-${conflict.secondId}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-meta"
              >
                <span className="min-w-0 truncate">
                  {conflict.firstTitle} ↔ {conflict.secondTitle}
                </span>
                <span className="shrink-0 text-label text-danger">
                  {conflict.overlapMinutes} min overlap
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2" aria-busy={isPending}>
          {view.totalEntries === 0 ? (
            <div className="rounded-xl border border-border bg-surface">
              <EmptyState
                size="page"
                icon={CalendarDays}
                title="Nothing scheduled."
                description="Classes, assignment deadlines, exams and tasks appear here automatically. Add your own events with the button above."
                action={
                  <Button size="sm" onClick={() => setIsEventOpen(true)}>
                    New event
                  </Button>
                }
              />
            </div>
          ) : (
            view.days
              .filter((day) => view.view !== "MONTH" || day.entries.length > 0)
              .map((day) => (
                <section
                  key={day.dayKey}
                  className={cn(
                    "overflow-hidden rounded-xl border bg-surface",
                    day.isToday ? "border-border-strong" : "border-border",
                  )}
                >
                  <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
                    <h2
                      className={cn(
                        "text-meta font-medium",
                        day.isPast && "text-muted-foreground",
                      )}
                    >
                      {day.weekdayLabel}
                      <span className="ml-2 text-label text-muted-foreground">
                        {day.label}
                      </span>
                    </h2>

                    {day.isToday ? (
                      <Badge variant="secondary">Today</Badge>
                    ) : day.busyMinutes > 0 ? (
                      <span className="text-label text-muted-foreground">
                        {Math.round(day.busyMinutes / 60)}h booked
                      </span>
                    ) : null}
                  </header>

                  {day.entries.length === 0 ? (
                    <p className="px-4 py-4 text-label text-muted-foreground">
                      Nothing scheduled.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border-subtle">
                      {day.entries.map((entry) => {
                        const meta = SOURCE_META[entry.source];
                        const Icon = meta.icon;

                        return (
                          <li
                            key={entry.id}
                            className="flex items-start gap-3 px-4 py-2.5"
                          >
                            <Icon
                              className={cn(
                                "mt-0.5 size-4 shrink-0",
                                meta.className,
                              )}
                              aria-hidden
                            />

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-meta">
                                {entry.title}
                              </p>
                              <p className="text-label text-muted-foreground">
                                {entry.timeLabel}
                                {entry.subtitle ? ` · ${entry.subtitle}` : ""}
                                {` · ${meta.label}`}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))
          )}
        </div>

        <ReminderPanel reminders={reminders} todayKey={todayKey} />
      </div>

      <EventDialog
        isOpen={isEventOpen}
        onOpenChange={setIsEventOpen}
        defaultDateKey={view.anchorKey}
      />
    </div>
  );
}
