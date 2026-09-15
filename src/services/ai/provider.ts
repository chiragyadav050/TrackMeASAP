/**
 * AI provider boundary.
 *
 * PHASE 1 DEFINES THE INTERFACE ONLY. No model is called, no SDK is
 * installed, and no API key is read. The contract exists now so that Phase 8
 * can add a `GeminiProvider` — and later an `OpenAIProvider` or
 * `ClaudeProvider` — without any caller changing.
 *
 * Why an interface this early: the assistant will eventually be invoked from
 * at least three places (the AI surface, the Telegram bot, and background
 * planning jobs). Pinning the shape now prevents three different ad-hoc
 * integrations from growing in parallel.
 *
 * See docs/ARCHITECTURE.md § Future AI architecture.
 */

export type AiRole = "system" | "user" | "assistant" | "tool";

export type AiMessage = {
  readonly role: AiRole;
  readonly content: string;
  /** Set when `role` is "tool"; correlates a result with its call. */
  readonly toolCallId?: string;
};

/**
 * A capability the model may invoke. Phase 8 will expose Life OS operations
 * (create task, look up an exam, summarise the week) through this shape.
 */
export type AiToolDefinition = {
  readonly name: string;
  readonly description: string;
  /** JSON Schema describing the arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
};

export type AiToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
};

export type AiCompletionRequest = {
  readonly messages: readonly AiMessage[];
  readonly tools?: readonly AiToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  /** Abort signal so a slow model call cannot pin a request forever. */
  readonly signal?: AbortSignal;
};

export type AiUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type AiCompletion = {
  readonly text: string;
  readonly toolCalls: readonly AiToolCall[];
  readonly usage: AiUsage | null;
};

/**
 * Request for a response that must conform to a schema, used wherever the
 * model's output feeds code rather than a human (plan generation, extraction).
 */
export type AiStructuredRequest<TShape> = AiCompletionRequest & {
  /** JSON Schema the response must satisfy. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** Validates and narrows the parsed response. Throws on mismatch. */
  readonly parse: (value: unknown) => TShape;
};

export interface AiProvider {
  /** Stable identifier for logs and cost attribution, e.g. "gemini". */
  readonly id: string;

  complete(request: AiCompletionRequest): Promise<AiCompletion>;

  completeStructured<TShape>(
    request: AiStructuredRequest<TShape>,
  ): Promise<TShape>;
}

/**
 * Thrown by {@link getAiProvider} until a real provider is registered.
 *
 * Failing loudly — rather than returning a stub that invents an answer — is
 * the point: nothing in Life OS may present fabricated AI output as real.
 */
export class AiProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is configured. The Gemini provider arrives in Phase 8.",
    );
    this.name = "AiProviderNotConfiguredError";
  }
}

let registered: AiProvider | null = null;

/** Registration hook for Phase 8. */
export function registerAiProvider(provider: AiProvider): void {
  registered = provider;
}

export function isAiConfigured(): boolean {
  return registered !== null;
}

export function getAiProvider(): AiProvider {
  if (!registered) {
    throw new AiProviderNotConfiguredError();
  }

  return registered;
}
