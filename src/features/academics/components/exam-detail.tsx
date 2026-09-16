"use client";

import { ListChecks, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { NativeSelect } from "@/components/form/native-select";
import { SectionCard } from "@/components/common/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  createExamTopicCommand,
  deleteExamTopicCommand,
  setTopicCompletionCommand,
} from "@/features/academics/actions";
import {
  EXAM_TYPE_LABELS,
  PreparationFigure,
} from "@/features/academics/components/academic-badges";
import { cn } from "@/lib/utils";
import { TOPIC_IMPORTANCES } from "@/services/academics/academic.schema";
import type { ExamDto, ExamTopicDto, TopicImportance } from "@/types/academics";

const IMPORTANCE_LABELS: Record<TopicImportance, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

const IMPORTANCE_CLASS: Record<TopicImportance, string> = {
  HIGH: "text-danger",
  MEDIUM: "text-muted-foreground",
  LOW: "text-muted-foreground/70",
};

type ExamDetailProps = {
  readonly exam: ExamDto;
  readonly topics: readonly ExamTopicDto[];
};

/**
 * One exam, with its syllabus checklist.
 *
 * The preparation percentage shown here is EXACTLY the figure the priority
 * engine uses — a plain completed/total count. Importance shapes what the
 * engine recommends studying next; it never distorts the headline number,
 * which stays verifiable at a glance.
 */
export function ExamDetail({ exam, topics }: ExamDetailProps) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [importance, setImportance] = useState<TopicImportance>("MEDIUM");

  const run = (
    operation: () => Promise<{ status: string; message?: string }>,
  ) => {
    startTransition(async () => {
      const result = await operation();

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't update the topic.");
      }
    });
  };

  const addTopic = () => {
    const title = draft.trim();

    if (title === "") {
      return;
    }

    setDraft("");
    run(() => createExamTopicCommand({ examId: exam.id, title, importance }));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title font-semibold tracking-tight">
                {exam.title}
              </h2>
              <Badge variant="outline">{EXAM_TYPE_LABELS[exam.type]}</Badge>
              {exam.status !== "UPCOMING" ? (
                <Badge variant="secondary">{exam.status.toLowerCase()}</Badge>
              ) : null}
            </div>

            <p className="text-meta text-muted-foreground">
              {[
                exam.subjectName,
                exam.dateLabel
                  ? `${exam.dateLabel}${exam.timeLabel ? `, ${exam.timeLabel}` : ""}`
                  : "No date set",
                exam.location,
                exam.durationMinutes ? `${exam.durationMinutes} min` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {exam.daysRemaining !== null && exam.status === "UPCOMING" ? (
            <div className="text-right">
              <p className="text-title font-semibold tabular-nums">
                {exam.daysRemaining < 0
                  ? "—"
                  : exam.daysRemaining === 0
                    ? "Today"
                    : exam.daysRemaining}
              </p>
              {exam.daysRemaining > 0 ? (
                <p className="text-label text-muted-foreground">
                  {exam.daysRemaining === 1 ? "day away" : "days away"}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 border-t border-border-subtle pt-3">
          <PreparationFigure
            percentage={exam.preparationPercent}
            completedTopics={exam.completedTopics}
            totalTopics={exam.totalTopics}
          />
          {exam.remainingHighImportance > 0 ? (
            <p className="mt-1 text-label text-muted-foreground">
              {exam.remainingHighImportance} high-importance{" "}
              {exam.remainingHighImportance === 1 ? "topic" : "topics"} still to
              cover.
            </p>
          ) : null}
        </div>
      </section>

      <SectionCard
        title="Syllabus topics"
        icon={ListChecks}
        description="Preparation is completed topics ÷ total topics."
        badge={`${exam.completedTopics}/${exam.totalTopics}`}
      >
        {topics.length > 0 ? (
          <ul className="divide-y divide-border-subtle">
            {topics.map((topic) => (
              <li
                key={topic.id}
                className="group flex items-start gap-3 px-4 py-2.5"
              >
                <Checkbox
                  id={`topic-${topic.id}`}
                  checked={topic.isCompleted}
                  disabled={isPending}
                  onCheckedChange={(checked) =>
                    run(() =>
                      setTopicCompletionCommand({
                        topicId: topic.id,
                        isCompleted: checked === true,
                      }),
                    )
                  }
                  aria-label={
                    topic.isCompleted
                      ? `Mark ${topic.title} as not covered`
                      : `Mark ${topic.title} as covered`
                  }
                  className="mt-0.5"
                />

                <label
                  htmlFor={`topic-${topic.id}`}
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer text-meta",
                    topic.isCompleted && "text-muted-foreground line-through",
                  )}
                >
                  {topic.title}
                  {topic.description ? (
                    <span className="block text-label text-muted-foreground">
                      {topic.description}
                    </span>
                  ) : null}
                </label>

                <span
                  className={cn(
                    "shrink-0 text-label",
                    IMPORTANCE_CLASS[topic.importance],
                  )}
                >
                  {IMPORTANCE_LABELS[topic.importance]}
                </span>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${topic.title}`}
                  className="reveal-on-hover shrink-0"
                  onClick={() =>
                    run(() => deleteExamTopicCommand({ topicId: topic.id }))
                  }
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={ListChecks}
            title="Preparation tracking not started"
            description="Add the syllabus topics and tick them off as you cover them."
            className="flex-1"
          />
        )}

        <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-3">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a topic…"
            aria-label="New topic"
            maxLength={200}
            className="h-8"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTopic();
              }
            }}
          />

          <NativeSelect
            value={importance}
            onChange={(event) =>
              setImportance(event.target.value as TopicImportance)
            }
            aria-label="Topic importance"
            className="h-8 w-auto min-w-24 text-meta"
          >
            {TOPIC_IMPORTANCES.map((value) => (
              <option key={value} value={value}>
                {IMPORTANCE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>

          <Button
            variant="outline"
            size="sm"
            onClick={addTopic}
            disabled={isPending || draft.trim() === ""}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
