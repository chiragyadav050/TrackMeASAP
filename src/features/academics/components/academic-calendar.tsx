import {
  CalendarDays,
  ClipboardList,
  FileText,
  GraduationCap,
  Presentation,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { cn } from "@/lib/utils";

/**
 * A unified academic event.
 *
 * Classes, assignments, assessments and exams are different entities with
 * different rules, so they are NOT merged in the database. They are unified
 * only at the point of display, keeping `kind` and `href` so every row still
 * links back to the record it came from.
 *
 * Phase 6 will generalise this into a real calendar abstraction across all of
 * Life OS; this is the academic slice of it.
 */
export type AcademicEvent = {
  readonly id: string;
  readonly kind: "CLASS" | "ASSIGNMENT" | "ASSESSMENT" | "EXAM";
  readonly title: string;
  readonly subtitle: string | null;
  readonly dayKey: string;
  readonly dayLabel: string;
  readonly timeLabel: string | null;
  readonly href: string | null;
  readonly isPast: boolean;
  readonly isCancelled: boolean;
};

export type TimetableEntry = {
  readonly id: string;
  readonly dayOfWeek: number;
  readonly subjectName: string;
  readonly subjectCode: string | null;
  readonly timeLabel: string;
  readonly room: string | null;
  readonly sessionType: string;
};

const KIND_META: Record<
  AcademicEvent["kind"],
  { icon: typeof CalendarDays; label: string; className: string }
> = {
  CLASS: {
    icon: Presentation,
    label: "Class",
    className: "text-muted-foreground",
  },
  ASSIGNMENT: {
    icon: ClipboardList,
    label: "Assignment",
    className: "text-brand-text",
  },
  ASSESSMENT: {
    icon: GraduationCap,
    label: "Test",
    className: "text-warning",
  },
  EXAM: { icon: FileText, label: "Exam", className: "text-danger" },
};

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function AcademicCalendar({
  events,
  timetable,
}: {
  events: readonly AcademicEvent[];
  timetable: readonly TimetableEntry[];
}) {
  // Group by local day, preserving the order the server produced.
  const byDay = new Map<string, { label: string; items: AcademicEvent[] }>();

  for (const event of events) {
    const existing = byDay.get(event.dayKey);

    if (existing) {
      existing.items.push(event);
    } else {
      byDay.set(event.dayKey, { label: event.dayLabel, items: [event] });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SectionCard
        title="Next three weeks"
        icon={CalendarDays}
        description="Classes, deadlines, tests and exams on one timeline."
        className="lg:col-span-2"
      >
        {byDay.size > 0 ? (
          <ul className="divide-y divide-border-subtle">
            {[...byDay.entries()].map(([dayKey, group]) => (
              <li key={dayKey} className="px-4 py-3">
                <p className="text-label-caps text-muted-foreground">
                  {group.label}
                </p>

                <ul className="mt-2 space-y-1.5">
                  {group.items.map((event) => (
                    <li key={`${event.kind}-${event.id}`}>
                      <EventRow event={event} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled"
            description="Classes, assignment deadlines and exams will appear here."
            className="flex-1"
          />
        )}
      </SectionCard>

      <SectionCard
        title="Weekly timetable"
        icon={Presentation}
        description="Your recurring schedule."
        footer="Cancelling one class does not change this pattern."
      >
        {timetable.length > 0 ? (
          <div className="space-y-3 px-4 py-4">
            {WEEKDAY_NAMES.map((name, index) => {
              const day = index + 1;
              const entries = timetable.filter(
                (entry) => entry.dayOfWeek === day,
              );

              if (entries.length === 0) {
                return null;
              }

              return (
                <div key={name}>
                  <p className="text-label-caps text-muted-foreground">
                    {name}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-baseline justify-between gap-2 text-meta"
                      >
                        <span className="truncate">
                          {entry.subjectCode ?? entry.subjectName}
                          {entry.room ? (
                            <span className="text-label text-muted-foreground">
                              {" "}
                              · {entry.room}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                          {entry.timeLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Presentation}
            title="No timetable yet"
            description="A recurring schedule lets Life OS generate real classes to mark attendance against."
            className="flex-1"
          />
        )}
      </SectionCard>
    </div>
  );
}

function EventRow({ event }: { event: AcademicEvent }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;

  const content: ReactNode = (
    <span
      className={cn(
        "flex items-center gap-2",
        (event.isPast || event.isCancelled) && "opacity-60",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", meta.className)} aria-hidden />

      <span className="min-w-0 flex-1 truncate text-meta">
        <span className={cn(event.isCancelled && "line-through")}>
          {event.title}
        </span>
        {event.subtitle ? (
          <span className="text-label text-muted-foreground">
            {" "}
            · {event.subtitle}
          </span>
        ) : null}
      </span>

      {/* The kind is named in text, never signalled by colour alone. */}
      <span className="shrink-0 text-label text-muted-foreground">
        {event.isCancelled ? "Cancelled" : meta.label}
      </span>

      {event.timeLabel ? (
        <span className="w-16 shrink-0 text-right text-label text-muted-foreground tabular-nums">
          {event.timeLabel}
        </span>
      ) : null}
    </span>
  );

  if (!event.href) {
    return content;
  }

  return (
    <Link
      href={event.href as never}
      className="-mx-1 block rounded px-1 py-0.5 transition-colors hover:bg-muted/40"
    >
      {content}
    </Link>
  );
}
