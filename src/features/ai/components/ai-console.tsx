"use client";

import { AlertTriangle, Check, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  confirmAiActionCommand,
  rejectAiActionCommand,
  sendAiMessageCommand,
} from "@/features/ai/actions";
import { cn } from "@/lib/utils";

export type AiStatus = {
  readonly isAvailable: boolean;
  readonly toolCount: number;
  readonly usage: {
    readonly requests: number;
    readonly requestLimit: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly tokenLimit: number;
  };
};

type Turn = {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly actions?: readonly { summary: string }[];
};

type Pending = { readonly id: string; readonly summary: string };

/**
 * The AI console.
 *
 * Two things this deliberately does NOT do.
 *
 * It never shows a fabricated reply. With no provider configured the input is
 * disabled and the page says exactly why — an assistant that answers without
 * a model is worse than no assistant.
 *
 * It never auto-confirms. A destructive proposal renders as an explicit
 * choice, worded by the SERVER from validated arguments, and nothing happens
 * until the user picks.
 */
export function AiConsole({
  status,
  memories,
}: {
  status: AiStatus;
  memories: readonly { id: string; kind: string; content: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState<readonly Pending[]>([]);

  const send = () => {
    const message = draft.trim();

    if (message.length === 0 || !status.isAvailable) {
      return;
    }

    setDraft("");
    setTurns((previous) => [...previous, { role: "user", text: message }]);

    startTransition(async () => {
      const result = await sendAiMessageCommand({
        message,
        conversationId: conversationId ?? undefined,
      });

      if (result.status !== "success") {
        const reason =
          result.status === "error"
            ? (result.message ?? "The assistant couldn't answer.")
            : "The assistant couldn't answer.";

        toast.error(reason);

        // Shown in the thread rather than only as a toast: the user needs to
        // see that their message did NOT get an answer.
        setTurns((previous) => [
          ...previous,
          { role: "assistant", text: reason },
        ]);
        return;
      }

      setConversationId(result.data.conversationId);
      setPending(result.data.pendingConfirmations);
      setTurns((previous) => [
        ...previous,
        {
          role: "assistant",
          text: result.data.reply,
          actions: result.data.actions,
        },
      ]);
    });
  };

  const answer = (id: string, isConfirmed: boolean) => {
    startTransition(async () => {
      const result = isConfirmed
        ? await confirmAiActionCommand({ actionId: id })
        : await rejectAiActionCommand({ actionId: id });

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't complete that.");
        return;
      }

      setPending((previous) => previous.filter((item) => item.id !== id));
      toast.success(isConfirmed ? "Done." : "Cancelled.");

      if (isConfirmed) {
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI"
        description="An assistant with context on your real tasks, coursework and calendar."
        actions={
          status.isAvailable ? (
            <Badge variant="secondary">{status.toolCount} tools</Badge>
          ) : null
        }
      />

      {!status.isAvailable ? (
        <Alert>
          <Sparkles className="size-4" />
          <AlertTitle>No AI provider is configured</AlertTitle>
          <AlertDescription>
            Set <code>GEMINI_API_KEY</code> to enable the assistant. Nothing on
            this page is generated until a real model is connected — Life OS
            will not invent an answer.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard
            title="Conversation"
            icon={Sparkles}
            footer={
              status.isAvailable
                ? `${status.usage.requests} of ${status.usage.requestLimit} requests today.`
                : undefined
            }
          >
            {turns.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title={
                  status.isAvailable
                    ? "Ask about your day."
                    : "The assistant is offline."
                }
                description={
                  status.isAvailable
                    ? "Everything it tells you comes from your real data, through the same rules the rest of the app follows."
                    : "Connect a model to start. Until then this page stays empty rather than showing sample answers."
                }
              />
            ) : (
              <ul className="space-y-3 p-4">
                {turns.map((turn, index) => (
                  <li
                    key={index}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-meta",
                      turn.role === "user"
                        ? "ml-auto bg-accent/10"
                        : "bg-surface-sunken",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{turn.text}</p>

                    {turn.actions && turn.actions.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 border-t border-border-subtle pt-2">
                        {turn.actions.map((action, actionIndex) => (
                          <li
                            key={actionIndex}
                            className="text-label text-muted-foreground"
                          >
                            ✓ {action.summary}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}

                {isPending ? (
                  <li className="text-label text-muted-foreground">
                    Thinking…
                  </li>
                ) : null}
              </ul>
            )}

            <div className="flex items-end gap-2 border-t border-border-subtle p-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  status.isAvailable
                    ? "What should I focus on today?"
                    : "Connect a model to use the assistant"
                }
                aria-label="Message the assistant"
                rows={2}
                disabled={!status.isAvailable || isPending}
                className="min-h-0 flex-1 resize-none"
              />

              <Button
                size="sm"
                onClick={send}
                disabled={
                  !status.isAvailable || isPending || draft.trim().length === 0
                }
              >
                <Send className="size-3.5" />
                Send
              </Button>
            </div>
          </SectionCard>

          {pending.length > 0 ? (
            <SectionCard
              title="Waiting for your confirmation"
              icon={AlertTriangle}
              description="These change or remove data, so nothing happens until you say so."
            >
              <ul className="divide-y divide-border-subtle">
                {pending.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="min-w-0 text-meta">{item.summary}</span>

                    <span className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => answer(item.id, false)}
                      >
                        <X className="size-3.5" />
                        No
                      </Button>

                      <Button
                        size="sm"
                        disabled={isPending}
                        onClick={() => answer(item.id, true)}
                      >
                        <Check className="size-3.5" />
                        Yes, do it
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}
        </div>

        <SectionCard
          title="What it remembers"
          icon={Sparkles}
          description="Readable and deletable — nothing about you is stored as an opaque vector."
        >
          {memories.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing remembered yet."
              description="The assistant will note durable preferences here, and you can delete any of them."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {memories.map((memory) => (
                <li key={memory.id} className="px-4 py-2.5">
                  <p className="text-meta">{memory.content}</p>
                  <p className="text-label text-muted-foreground">
                    {memory.kind.toLowerCase().replace("_", " ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
