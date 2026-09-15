"use client";

import { Check, Copy, MessageCircle, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  issueLinkTokenCommand,
  unlinkTelegramCommand,
} from "@/features/telegram/actions";

export type TelegramStatus = {
  readonly isLinked: boolean;
  readonly username: string | null;
  readonly linkedLabel: string | null;
  readonly isBotConfigured: boolean;
  readonly isWebhookConfigured: boolean;
};

/**
 * Telegram settings.
 *
 * The link code is shown ONCE, in the client, and is never stored anywhere in
 * plaintext. It is deliberately held in component state rather than written
 * to the URL or to local storage — a secret in a URL ends up in browser
 * history and in server logs.
 */
export function TelegramPanel({ status }: { status: TelegramStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  const generate = () => {
    startTransition(async () => {
      const result = await issueLinkTokenCommand({});

      if (result.status !== "success") {
        toast.error(
          result.status === "error"
            ? (result.message ?? "Couldn't generate a code.")
            : "Couldn't generate a code.",
        );
        return;
      }

      setCode(result.data.token);
      setExpiresAt(new Date(result.data.expiresAt));
    });
  };

  const unlink = () => {
    const confirmed = window.confirm(
      "Disconnect Telegram? Reminders will stop arriving there until you link again.",
    );

    if (!confirmed) return;

    startTransition(async () => {
      const result = await unlinkTelegramCommand({});

      if (result.status === "error") {
        toast.error(result.message ?? "Couldn't unlink.");
        return;
      }

      setCode(null);
      toast.success("Telegram disconnected.");
      router.refresh();
    });
  };

  const copy = async () => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(`/link ${code}`);
      toast.success("Copied. Paste it to the bot.");
    } catch {
      // Clipboard access can be denied; the code is on screen either way.
      toast.error("Couldn't copy — select the code and copy it manually.");
    }
  };

  return (
    <SectionCard
      title="Telegram"
      icon={MessageCircle}
      description="Capture tasks and check your day from a chat."
    >
      <div className="space-y-4 p-4">
        {!status.isBotConfigured ? (
          <Alert>
            <AlertDescription>
              No bot is configured on this server, so linking cannot complete.
              An administrator needs to set <code>TELEGRAM_BOT_TOKEN</code> and{" "}
              <code>TELEGRAM_WEBHOOK_SECRET</code>.
            </AlertDescription>
          </Alert>
        ) : null}

        {status.isLinked ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-meta font-medium">
                  Connected
                  <Badge variant="secondary">
                    {status.username ? `@${status.username}` : "Telegram"}
                  </Badge>
                </p>

                {status.linkedLabel ? (
                  <p className="text-label text-muted-foreground">
                    Linked {status.linkedLabel}
                  </p>
                ) : null}
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={unlink}
              >
                <Unlink className="size-3.5" />
                Disconnect
              </Button>
            </div>

            <p className="text-label text-muted-foreground">
              Send <code>/help</code> to the bot to see what it can do.
            </p>
          </>
        ) : code ? (
          <>
            <p className="text-meta">
              Send this to the bot on Telegram. It works once, and expires
              {expiresAt
                ? ` at ${expiresAt.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : " shortly"}
              .
            </p>

            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-sunken px-3 py-2 font-mono text-label">
                /link {code}
              </code>

              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>

            <Alert>
              <AlertDescription>
                Treat this like a password — anyone who sends it to the bot
                gains access to your Life OS data. It is shown once and is not
                stored anywhere.
              </AlertDescription>
            </Alert>

            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={generate}
            >
              Generate a new code instead
            </Button>
          </>
        ) : (
          <>
            <p className="text-meta text-muted-foreground">
              Not connected. Generate a one-time code, then send it to the bot
              as <code>/link YOUR_CODE</code>.
            </p>

            <Button size="sm" disabled={isPending} onClick={generate}>
              {isPending ? (
                <Check className="size-3.5" />
              ) : (
                <MessageCircle className="size-3.5" />
              )}
              Generate link code
            </Button>
          </>
        )}
      </div>
    </SectionCard>
  );
}
