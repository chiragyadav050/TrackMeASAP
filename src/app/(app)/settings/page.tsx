import { Info } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PreferencesForm } from "@/features/settings/preferences-form";
import { formatInTimeZone } from "@/lib/time";
import { requireProfileForPage } from "@/server/auth";
import { toProfileDto } from "@/services/profile/profile.service";
import { NotificationSettingsForm } from "@/features/schedule/components/notification-settings-form";
import { TelegramPanel } from "@/features/telegram/components/telegram-panel";
import { getNotificationSettings } from "@/services/schedule/notification.service";
import { describeConfiguration } from "@/services/telegram/telegram.client";
import { getLinkForProfile } from "@/services/telegram/telegram.link";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const profile = await requireProfileForPage();

  const [notificationSettings, telegramLink] = await Promise.all([
    getNotificationSettings(profile.id),
    getLinkForProfile(profile.id),
  ]);

  // Booleans only — the token and webhook secret never cross this boundary.
  const telegramConfiguration = describeConfiguration();

  const localNow = formatInTimeZone(
    new Date(),
    profile.timeZone,
    { dateStyle: "medium", timeStyle: "short" },
    profile.locale,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your profile and the preferences that shape how Life OS reads your day."
      />

      <SectionCard
        title="Profile & preferences"
        description="Changes apply immediately across the app."
        footer={`It is currently ${localNow} in ${profile.timeZone.replaceAll("_", " ")}.`}
      >
        <div className="px-4 py-5">
          <PreferencesForm profile={toProfileDto(profile)} />
        </div>
      </SectionCard>

      <NotificationSettingsForm settings={notificationSettings} />

      <TelegramPanel
        status={{
          isLinked: telegramLink?.isActive ?? false,
          username: telegramLink?.telegramUsername ?? null,
          linkedLabel: telegramLink?.linkedAt
            ? formatInTimeZone(
                telegramLink.linkedAt,
                profile.timeZone,
                { dateStyle: "medium" },
                profile.locale,
              )
            : null,
          isBotConfigured: telegramConfiguration.hasToken,
          isWebhookConfigured: telegramConfiguration.hasWebhookSecret,
        }}
      />

      <Alert>
        <Info className="size-4" />
        <AlertTitle>Account security lives in Clerk</AlertTitle>
        <AlertDescription>
          Email address, password, connected accounts and multi-factor
          authentication are managed by Clerk, not stored by Life OS.
        </AlertDescription>
      </Alert>
    </div>
  );
}
