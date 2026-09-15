"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAuthenticatedCommand } from "@/server/action";
import { describeConfiguration } from "@/services/telegram/telegram.client";
import {
  getLinkForProfile,
  issueLinkToken,
  unlinkTelegram,
} from "@/services/telegram/telegram.link";

/**
 * Telegram server actions.
 *
 * SECRET HANDLING. `issueLinkTokenCommand` is the only action in Life OS that
 * returns a secret to the client. It is returned ONCE, never persisted in
 * plaintext, and never logged. The bot token itself is never returned by any
 * action — only two booleans describing whether it is configured.
 */

export const issueLinkTokenCommand = createAuthenticatedCommand({
  name: "telegram.issueToken",
  schema: z.object({}),
  handler: async (
    _input,
    { profile },
  ): Promise<{ token: string; expiresAt: Date }> => {
    const issued = await issueLinkToken(profile.id);

    revalidatePath("/settings");

    // Shown once. Any previously issued token was invalidated by the call
    // above, so the user never holds two live secrets.
    return issued;
  },
});

/**
 * Disconnects the chat.
 *
 * Deliberately NOT a confirmation-free convenience: the UI asks first,
 * because a user who unlinks by accident loses their reminders channel.
 */
export const unlinkTelegramCommand = createAuthenticatedCommand({
  name: "telegram.unlink",
  schema: z.object({}),
  handler: async (_input, { profile }): Promise<{ unlinked: true }> => {
    await unlinkTelegram(profile.id);

    revalidatePath("/settings");

    return { unlinked: true };
  },
});

/** Current link state, for the settings panel. */
export const getTelegramStatusCommand = createAuthenticatedCommand({
  name: "telegram.status",
  schema: z.object({}),
  handler: async (_input, { profile }) => {
    const link = await getLinkForProfile(profile.id);
    const configuration = describeConfiguration();

    return {
      isLinked: link?.isActive ?? false,
      // Display only — never used for authorisation.
      username: link?.telegramUsername ?? null,
      linkedAt: link?.linkedAt ?? null,
      // Booleans only. The values themselves never cross this boundary.
      isBotConfigured: configuration.hasToken,
      isWebhookConfigured: configuration.hasWebhookSecret,
    };
  },
});
