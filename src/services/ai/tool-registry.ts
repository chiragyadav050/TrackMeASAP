import "server-only";

import { z } from "zod";

import type { Profile } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import type { AiToolDefinition } from "@/services/ai/provider";

/**
 * The AI tool boundary.
 *
 * THIS IS THE FILE THAT KEEPS THE MODEL HONEST. Four rules, all enforced
 * mechanically rather than by convention:
 *
 *  1. A tool NEVER receives a profile id. The executor injects the caller's
 *     own profile. The model cannot name whose data to touch, because there
 *     is no argument through which to say it.
 *
 *  2. Every tool's arguments go through a ZOD SCHEMA before the handler runs.
 *     Model output is untrusted input — as untrusted as a form post — and is
 *     validated exactly like one.
 *
 *  3. Every tool declares a RISK level. DESTRUCTIVE tools are never executed
 *     directly; they return a proposal the user must confirm. Deletes,
 *     cancellations and anything outward-facing are destructive by
 *     definition.
 *
 *  4. Handlers call APPLICATION SERVICES, never Prisma. Ownership checks,
 *     validation and activity logging therefore apply to the AI exactly as
 *     they apply to the UI.
 *
 * A tool's `summarise` function — not the model — writes the sentence shown
 * in a confirmation prompt. The thing asking for permission must not get to
 * word the question.
 */

const log = logger.child({ service: "ai.tools" });

export type ToolRisk = "SAFE" | "MODERATE" | "DESTRUCTIVE";

export type ToolContext = {
  /** Injected by the executor from the session. Never from the model. */
  readonly profile: Profile;
  readonly now: Date;
  readonly conversationId: string | null;
};

export type ToolDefinition<TSchema extends z.ZodType = z.ZodType> = {
  readonly name: string;
  readonly description: string;
  readonly schema: TSchema;
  readonly risk: ToolRisk;
  /**
   * One line a human can read before confirming. Written by US, from the
   * VALIDATED arguments — never by the model.
   */
  readonly summarise: (args: z.infer<TSchema>) => string;
  readonly handler: (
    args: z.infer<TSchema>,
    context: ToolContext,
  ) => Promise<unknown>;
};

const registry = new Map<string, ToolDefinition>();

/** Registers a tool. Duplicate names are a programming error, not a warning. */
export function registerTool<TSchema extends z.ZodType>(
  definition: ToolDefinition<TSchema>,
): void {
  if (registry.has(definition.name)) {
    throw new Error(`Duplicate AI tool registered: ${definition.name}`);
  }

  registry.set(definition.name, definition as ToolDefinition);
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): readonly ToolDefinition[] {
  return [...registry.values()];
}

export function toolCount(): number {
  return registry.size;
}

/** Clears the registry. Test-only; a running server never calls this. */
export function resetToolRegistry(): void {
  registry.clear();
}

/**
 * The tool list as the provider needs it.
 *
 * Converts each Zod schema to JSON Schema. The model therefore sees exactly
 * the shape we will validate against, so a well-behaved model rarely produces
 * an invalid call — and a badly-behaved one is rejected anyway.
 */
export function toProviderTools(): readonly AiToolDefinition[] {
  return listTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema, {
      io: "input",
      unrepresentable: "any",
    }) as Record<string, unknown>,
  }));
}

export type ToolOutcome =
  | {
      readonly status: "OK";
      readonly result: unknown;
      readonly summary: string;
    }
  | {
      readonly status: "NEEDS_CONFIRMATION";
      readonly summary: string;
      readonly toolName: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly status: "ERROR"; readonly message: string };

/**
 * Runs one tool call.
 *
 * `rawArguments` come from the MODEL and are treated as hostile input. A
 * DESTRUCTIVE tool short-circuits into a confirmation request without its
 * handler ever running.
 */
export async function executeTool(
  toolName: string,
  rawArguments: unknown,
  context: ToolContext,
  options: { readonly allowDestructive?: boolean } = {},
): Promise<ToolOutcome> {
  const tool = registry.get(toolName);

  if (!tool) {
    // A hallucinated tool name is a normal occurrence, not an exception.
    return {
      status: "ERROR",
      message: `Unknown tool: ${toolName}`,
    };
  }

  const parsed = tool.schema.safeParse(rawArguments ?? {});

  if (!parsed.success) {
    return {
      status: "ERROR",
      message: `Invalid arguments for ${toolName}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "value"} ${issue.message}`)
        .join("; ")
        .slice(0, 300)}`,
    };
  }

  const summary = tool.summarise(parsed.data);

  // Rule 3. The handler does not run.
  if (tool.risk === "DESTRUCTIVE" && !options.allowDestructive) {
    return {
      status: "NEEDS_CONFIRMATION",
      summary,
      toolName,
      arguments: parsed.data as Record<string, unknown>,
    };
  }

  try {
    const result = await tool.handler(parsed.data, context);

    return { status: "OK", result, summary };
  } catch (error) {
    // The model gets a short, safe message. The detail goes to the log.
    log.warn("AI tool failed", {
      toolName,
      profileId: context.profile.id,
      error: error instanceof Error ? error.message : "unknown",
    });

    return {
      status: "ERROR",
      message:
        error instanceof Error
          ? error.message.slice(0, 200)
          : "The operation failed.",
    };
  }
}
