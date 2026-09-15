"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { Field, fieldAria } from "@/components/form/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { saveNotificationSettingsAction } from "@/features/schedule/actions";
import { formatMinutesAsTime, parseMinutesFromTime } from "@/lib/time";
import { IDLE_ACTION_STATE, type ActionState } from "@/types/action";
import type { NotificationSettingsDto } from "@/types/schedule";

/**
 * Quiet hours and the daily limit.
 *
 * Times are entered as `HH:MM` and posted as MINUTES since local midnight —
 * the same representation the profile's working hours use, which keeps the
 * value time-zone agnostic and trivially comparable.
 */
export function NotificationSettingsForm({
  settings,
}: {
  settings: NotificationSettingsDto;
}) {
  const router = useRouter();
  const [isQuietEnabled, setIsQuietEnabled] = useState(
    settings.isQuietHoursEnabled,
  );

  type SettingsActionState = ActionState<{ saved: true }>;

  const [state, formAction, isPending] = useActionState<
    SettingsActionState,
    FormData
  >(saveNotificationSettingsAction, IDLE_ACTION_STATE);

  const lastHandled = useRef<SettingsActionState>(IDLE_ACTION_STATE);

  useEffect(() => {
    if (state === lastHandled.current || state.status === "idle") {
      return;
    }

    lastHandled.current = state;

    if (state.status === "success") {
      toast.success("Notification settings saved.");
      router.refresh();
      return;
    }

    if (!state.fieldErrors) {
      toast.error(state.message ?? "Couldn't save the settings.");
    }
  }, [state, router]);

  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <SectionCard
      title="Notifications"
      icon={BellRing}
      description="When Life OS may interrupt you."
    >
      <form action={formAction} className="space-y-4 p-4" noValidate>
        {state.status === "error" && fieldErrors?._form ? (
          <Alert variant="destructive">
            <AlertDescription>{fieldErrors._form.join(" ")}</AlertDescription>
          </Alert>
        ) : null}

        <label className="flex items-center gap-2 text-meta">
          <Checkbox
            name="isQuietHoursEnabled"
            value="true"
            checked={isQuietEnabled}
            onCheckedChange={(checked) => setIsQuietEnabled(Boolean(checked))}
          />
          Hold notifications during quiet hours
        </label>

        {isQuietEnabled ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="quietHoursStart"
              label="Quiet from"
              errors={fieldErrors?.quietHoursStart}
            >
              <Input
                {...fieldAria("quietHoursStart", {
                  hasError: Boolean(fieldErrors?.quietHoursStart),
                })}
                type="time"
                name="quietHoursStartTime"
                defaultValue={
                  settings.quietHoursStart === null
                    ? "22:00"
                    : formatMinutesAsTime(settings.quietHoursStart)
                }
                className="h-9"
                onChange={(event) => {
                  // The action takes minutes; the browser gives HH:MM.
                  const minutes = parseMinutesFromTime(event.target.value);
                  const hidden = event.currentTarget.form?.elements.namedItem(
                    "quietHoursStart",
                  ) as HTMLInputElement | null;

                  if (hidden) hidden.value = String(minutes ?? "");
                }}
              />
              <input
                type="hidden"
                name="quietHoursStart"
                defaultValue={settings.quietHoursStart ?? 22 * 60}
              />
            </Field>

            <Field
              id="quietHoursEnd"
              label="Quiet until"
              hint="A window that crosses midnight is fine."
              errors={fieldErrors?.quietHoursEnd}
            >
              <Input
                {...fieldAria("quietHoursEnd", {
                  hasHint: true,
                  hasError: Boolean(fieldErrors?.quietHoursEnd),
                })}
                type="time"
                name="quietHoursEndTime"
                defaultValue={
                  settings.quietHoursEnd === null
                    ? "07:00"
                    : formatMinutesAsTime(settings.quietHoursEnd)
                }
                className="h-9"
                onChange={(event) => {
                  const minutes = parseMinutesFromTime(event.target.value);
                  const hidden = event.currentTarget.form?.elements.namedItem(
                    "quietHoursEnd",
                  ) as HTMLInputElement | null;

                  if (hidden) hidden.value = String(minutes ?? "");
                }}
              />
              <input
                type="hidden"
                name="quietHoursEnd"
                defaultValue={settings.quietHoursEnd ?? 7 * 60}
              />
            </Field>
          </div>
        ) : null}

        <Field
          id="dailyLimit"
          label="Daily limit"
          hint="Non-urgent notifications per day. Zero means unlimited."
          errors={fieldErrors?.dailyLimit}
        >
          <Input
            {...fieldAria("dailyLimit", {
              hasHint: true,
              hasError: Boolean(fieldErrors?.dailyLimit),
            })}
            type="number"
            name="dailyLimit"
            min={0}
            max={200}
            defaultValue={settings.dailyLimit}
            className="h-9 w-28"
          />
        </Field>

        <p className="text-label text-muted-foreground">
          Held notifications are delivered once quiet hours end — nothing is
          discarded. Urgent alerts always go through.
        </p>

        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
}
