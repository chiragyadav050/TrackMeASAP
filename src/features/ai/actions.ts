"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAuthenticatedCommand } from "@/server/action";
import { db } from "@/server/db";
import {
  confirmAction,
  getUsageToday,
  isAgentAvailable,
  rejectAction,
  runAgentTurn,
  type AgentTurn,
} from "@/services/ai/agent.service";
import { toolCount } from "@/services/ai/tool-registry";

/**
 * AI server actions.
 *
 * Note what no action here accepts: a profile id, a system prompt, or a tool
 * name to run directly. The model's capabilities are fixed at registration
 * and the caller's identity comes from the Clerk session.
 */

const messageSchema = z.object({
  message: z.string().trim().min(1, "Say something.").max(4000),
  conversationId: z.string().optional(),
});

export const sendAiMessageCommand = createAuthenticatedCommand({
  name: "ai.send",
  schema: messageSchema,
  handler: async (input, { profile }): Promise<AgentTurn> =>
    runAgentTurn(profile, {
      message: input.message,
      conversationId: input.conversationId ?? null,
      source: "WEB",
    }),
});

/**
 * Executes a destructive action the user has confirmed.
 *
 * This is the ONLY path by which a destructive tool ever runs. The decision
 * arrives from the user, not from the model.
 */
export const confirmAiActionCommand = createAuthenticatedCommand({
  name: "ai.confirm",
  schema: z.object({ actionId: z.string().min(1) }),
  handler: async (input, { profile }) => {
    const result = await confirmAction(profile, input.actionId);

    // A confirmed action can have changed anything, so the whole app refreshes.
    revalidatePath("/", "layout");

    return result;
  },
});

export const rejectAiActionCommand = createAuthenticatedCommand({
  name: "ai.reject",
  schema: z.object({ actionId: z.string().min(1) }),
  handler: async (input, { profile }): Promise<{ rejected: true }> => {
    await rejectAction(profile, input.actionId);
    return { rejected: true };
  },
});

/** Status for the AI page: availability, usage and what the model can do. */
export const getAiStatusCommand = createAuthenticatedCommand({
  name: "ai.status",
  schema: z.object({}),
  handler: async (_input, { profile }) => {
    const available = isAgentAvailable();
    const usage = await getUsageToday(profile, new Date());

    return {
      isAvailable: available,
      toolCount: toolCount(),
      usage,
    };
  },
});

/** Deletes a remembered fact. The user's own memory is theirs to clear. */
export const forgetAiMemoryCommand = createAuthenticatedCommand({
  name: "ai.forget",
  schema: z.object({ memoryId: z.string().min(1) }),
  handler: async (input, { profile }): Promise<{ deleted: boolean }> => {
    // Scoped delete — another user's id simply matches nothing.
    const result = await db.aIMemory.deleteMany({
      where: { id: input.memoryId, profileId: profile.id },
    });

    revalidatePath("/ai");

    return { deleted: result.count > 0 };
  },
});

export const clearAiConversationCommand = createAuthenticatedCommand({
  name: "ai.clearConversation",
  schema: z.object({ conversationId: z.string().min(1) }),
  handler: async (input, { profile }): Promise<{ archived: boolean }> => {
    const result = await db.aIConversation.updateMany({
      where: { id: input.conversationId, profileId: profile.id },
      data: { archivedAt: new Date() },
    });

    revalidatePath("/ai");

    return { archived: result.count > 0 };
  },
});
