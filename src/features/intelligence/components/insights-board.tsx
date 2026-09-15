"use client";

import {
  AlertTriangle,
  Clock,
  Eye,
  Gauge,
  Lightbulb,
  Timer,
} from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IntelligenceReport } from "@/services/intelligence/intelligence.query";

const COMPONENT_LABELS: Record<string, string> = {
  TASKS: "Tasks",
  ACADEMICS: "Academics",
  HABITS: "Habits",
  WELLBEING: "Check-ins",
};

const RISK_LABELS: Record<string, { label: string; className: string }> = {
  COMFORTABLE: { label: "Comfortable", className: "text-success" },
  TIGHT: { label: "Tight", className: "text-warning" },
  AT_RISK: { label: "At risk", className: "text-danger" },
  IMPOSSIBLE: { label: "Not achievable", className: "text-danger" },
};

/**
 * The insights surface.
 *
 * EVERY CLAIM SHOWS ITS EVIDENCE. That is not decoration — it is what makes
 * the difference between a system a user can check and one they must simply
 * believe. Where there is not enough data, the page says so instead of
 * filling the space.
 */
export function InsightsBoard({ report }: { report: IntelligenceReport }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="What Life OS has noticed, and the numbers behind each observation."
      />

      {report.isQuiet ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            size="page"
            icon={Eye}
            title="Nothing to report."
            description="There isn't enough tracked yet to say anything useful, and Life OS would rather stay quiet than guess. Use it for a couple of weeks and patterns will appear here."
            action={
              <Button
                size="sm"
                render={<Link href="/today">Go to Today</Link>}
              />
            }
          />
        </div>
      ) : null}

      {report.insights.length > 0 ? (
        <SectionCard
          title="Worth knowing"
          icon={Lightbulb}
          description="The few things important enough to interrupt for."
        >
          <ul className="divide-y divide-border-subtle">
            {report.insights.map((insight) => (
              <li key={insight.key} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={insight.href as never}
                      className="text-meta font-medium underline-offset-4 hover:underline"
                    >
                      {insight.title}
                    </Link>
                    <p className="text-label text-muted-foreground">
                      {insight.body}
                    </p>
                    {/* The numbers, always. */}
                    <p className="mt-1 text-label text-muted-foreground">
                      {insight.evidence}
                    </p>
                  </div>

                  <Badge
                    variant={
                      insight.severity === "URGENT" ? "destructive" : "outline"
                    }
                    className="shrink-0"
                  >
                    {insight.severity === "URGENT"
                      ? "Urgent"
                      : insight.severity === "WARN"
                        ? "Warning"
                        : "Note"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Life score"
          icon={Gauge}
          className="lg:col-span-2"
          description={report.lifeScore.note}
        >
          {report.lifeScore.overall === null ? (
            <EmptyState
              icon={Gauge}
              title="No score yet."
              description="A number here would be invented rather than measured. It appears once there is something to measure."
            />
          ) : (
            <div className="space-y-4 p-4">
              <p className="text-title font-semibold tabular-nums">
                {Math.round(report.lifeScore.overall)}
                <span className="ml-1 text-meta font-normal text-muted-foreground">
                  / 100
                </span>
              </p>

              <ul className="space-y-2">
                {report.lifeScore.components.map((component) => (
                  <li key={component.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-label">
                      <span>{COMPONENT_LABELS[component.key]}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          component.score === null && "text-muted-foreground",
                        )}
                      >
                        {component.score === null
                          ? "Not tracked"
                          : `${Math.round(component.score)}%`}
                      </span>
                    </div>

                    {component.score !== null ? (
                      <div
                        className="h-1 overflow-hidden rounded-full bg-surface-sunken"
                        role="progressbar"
                        aria-valuenow={Math.round(component.score)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={COMPONENT_LABELS[component.key]}
                      >
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.round(component.score)}%` }}
                        />
                      </div>
                    ) : null}

                    <p className="text-label text-muted-foreground">
                      {component.evidence}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Where time went"
          icon={Timer}
          description="Only what you logged."
        >
          {report.timeAudit.isEmpty ? (
            <EmptyState
              icon={Timer}
              title="Nothing logged."
              description="This shows logged study time only. It is blank because nothing was recorded — not because nothing happened."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {report.timeAudit.byCategory.map((entry) => (
                <li
                  key={entry.category}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 truncate text-meta">
                    {entry.category}
                  </span>
                  <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                    {Math.round(entry.minutes / 60)}h ·{" "}
                    {Math.round(entry.percent)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {report.deadlineRisks.length > 0 ? (
        <SectionCard
          title="Deadlines that need attention"
          icon={AlertTriangle}
          description="Remaining work divided by remaining days, against the time you actually have."
        >
          <ul className="divide-y divide-border-subtle">
            {report.deadlineRisks.map((risk) => (
              <li key={risk.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-meta font-medium">
                      {risk.title}
                    </p>
                    <p className="text-label text-muted-foreground">
                      {risk.evidence}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 text-label font-medium",
                      RISK_LABELS[risk.level]?.className,
                    )}
                  >
                    {RISK_LABELS[risk.level]?.label}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {report.patterns.length > 0 ? (
          <SectionCard
            title="Patterns"
            icon={Eye}
            description="Observed from your history. What happened, not why."
          >
            <ul className="divide-y divide-border-subtle">
              {report.patterns.map((pattern) => (
                <li key={pattern.kind} className="px-4 py-2.5">
                  <p className="text-meta">{pattern.statement}</p>
                  <p className="text-label text-muted-foreground">
                    {pattern.evidence}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        {report.forgotten.length > 0 ? (
          <SectionCard
            title="Gone quiet"
            icon={Clock}
            description="No due date, and nothing has changed in a month."
          >
            <ul className="divide-y divide-border-subtle">
              {report.forgotten.slice(0, 8).map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 truncate text-meta">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-label text-muted-foreground">
                    {item.daysUntouched}d
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
