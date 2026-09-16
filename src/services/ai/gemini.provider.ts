import "server-only";

import { logger } from "@/lib/logger";
import type {
  AiCompletion,
  AiCompletionRequest,
  AiProvider,
  AiStructuredRequest,
  AiToolCall,
} from "@/services/ai/provider";

/**
 * The Gemini provider.
 *
 * Implements the Phase 1 `AiProvider` interface, so nothing above it knows
 * which model is in use — and swapping to another vendor is a new file, not a
 * refactor.
 *
 * SECRET HANDLING. The API key is read per call from the environment, sent in
 * a HEADER rather than a query string (a URL ends up in logs and proxies),
 * and never appears in an error message. Fetch failures are reported as a
 * fixed string precisely because the raw error can contain the request URL.
 *
 * FAILING HONESTLY. When no key is configured, `isGeminiConfigured()` is
 * false and nothing registers. There is no stub that invents an answer —
 * inventing AI output would be the worst possible violation of this project's
 * rules.
 */

const log = logger.child({ service: "ai.gemini" });

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Long enough for a tool-using turn, short enough not to pin a request. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * The model to call.
 *
 * OVERRIDABLE BY ENVIRONMENT, and that is the point. This constant said
 * `gemini-2.0-flash`, which Google retired: every AI message failed with a
 * 404 while the API key itself was perfectly valid. Its successor
 * `gemini-2.5-flash` is already closed to new keys too, which is the whole
 * problem in one line — a pinned model name is a dated asset, and when it
 * expires the app breaks completely rather than degrading.
 *
 * With the override, the next retirement is a change to one environment
 * variable rather than a code change and a redeploy. `gemini-flash-latest`
 * is the obvious value to reach for if this default ever 404s again.
 *
 * Verified against the live API with a function-calling request before being
 * chosen, because tool use — not plain text — is what this agent depends on.
 */
export const DEFAULT_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

/**
 * JSON Schema keywords Gemini rejects outright.
 *
 * Its `parameters` field is not JSON Schema — it is a subset of the OpenAPI 3
 * schema object, and an unknown keyword is a hard 400 for the WHOLE request,
 * not a warning about one field. That is how every AI message came to fail
 * with "Something went wrong": Zod 4 emits a `$schema` declaration, Gemini
 * refused the payload, and all 45 tools went down with it.
 *
 * Stripped rather than avoided upstream on purpose. `toProviderTools()`
 * produces correct, standard JSON Schema; it is this provider's job to adapt
 * that to one vendor's dialect, so a second provider never inherits Gemini's
 * limitations.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "additionalProperties",
  "const",
  "examples",
  "default",
]);

/**
 * Recursively removes keywords Gemini cannot parse.
 *
 * Only the unknown keywords go: `type`, `description`, `enum`, `properties`,
 * `required`, `items` and the rest of the supported subset pass through
 * untouched, so the model still sees the real shape of each argument.
 */
function forGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(forGemini);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue;
    }

    result[key] = forGemini(nested);
  }

  return result;
}

function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function isGeminiConfigured(): boolean {
  return getApiKey() !== null;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string; status?: string };
};

/**
 * Converts our messages into Gemini's shape.
 *
 * Gemini has no "system" role: system instructions go in a separate
 * `systemInstruction` field, and a tool result is a `functionResponse` part
 * on a USER turn. Both are easy to get subtly wrong, so the mapping is
 * explicit here rather than inline at the call site.
 */
function toGeminiContents(request: AiCompletionRequest): {
  contents: GeminiContent[];
  systemInstruction: string | null;
} {
  const contents: GeminiContent[] = [];
  let systemInstruction: string | null = null;

  for (const message of request.messages) {
    if (message.role === "system") {
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n\n${message.content}`
        : message.content;
      continue;
    }

    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolCallId ?? "tool",
              // Gemini requires an object; a bare string is rejected.
              response: { result: message.content },
            },
          },
        ],
      });
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  return { contents, systemInstruction };
}

function extractToolCalls(parts: readonly GeminiPart[]): AiToolCall[] {
  const calls: AiToolCall[] = [];

  parts.forEach((part, index) => {
    if ("functionCall" in part) {
      calls.push({
        // Gemini does not supply call ids; the name plus position is stable
        // enough to correlate a result within one turn.
        id: `${part.functionCall.name}-${index}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  });

  return calls;
}

function extractText(parts: readonly GeminiPart[]): string {
  return parts
    .filter((part): part is { text: string } => "text" in part)
    .map((part) => part.text)
    .join("")
    .trim();
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini";

  constructor(private readonly model: string = DEFAULT_MODEL) {}

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const payload = this.buildPayload(request);
    const data = await this.post(
      `${this.model}:generateContent`,
      payload,
      request.signal,
    );

    const parts = data.candidates?.[0]?.content?.parts ?? [];

    return {
      text: extractText(parts),
      toolCalls: extractToolCalls(parts),
      usage: data.usageMetadata
        ? {
            inputTokens: data.usageMetadata.promptTokenCount ?? 0,
            outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
          }
        : null,
    };
  }

  /**
   * A response that must satisfy a schema.
   *
   * The schema is enforced TWICE: by Gemini's own `responseSchema`, and by the
   * caller's `parse` on the way out. The second check is the one that matters
   * — a model that ignores its schema must not be able to feed malformed data
   * into code that assumed it was validated.
   */
  async completeStructured<TShape>(
    request: AiStructuredRequest<TShape>,
  ): Promise<TShape> {
    const payload = {
      ...this.buildPayload(request),
      generationConfig: {
        temperature: request.temperature ?? 0.2,
        maxOutputTokens: request.maxOutputTokens ?? 2048,
        responseMimeType: "application/json",
        responseSchema: request.schema,
      },
      // Tools and JSON mode are mutually exclusive in Gemini.
      tools: undefined,
    };

    const data = await this.post(
      `${this.model}:generateContent`,
      payload,
      request.signal,
    );

    const text = extractText(data.candidates?.[0]?.content?.parts ?? []);

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The model did not return valid JSON.");
    }

    return request.parse(parsed);
  }

  private buildPayload(request: AiCompletionRequest): Record<string, unknown> {
    const { contents, systemInstruction } = toGeminiContents(request);

    return {
      contents,
      ...(systemInstruction
        ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
        : {}),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: forGemini(tool.parameters),
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        temperature: request.temperature ?? 0.4,
        maxOutputTokens: request.maxOutputTokens ?? 2048,
      },
    };
  }

  private async post(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GeminiResponse> {
    const key = getApiKey();

    if (!key) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Honour a caller's abort as well as our own timeout.
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const response = await fetch(`${API_BASE}/models/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A header, not `?key=` — a URL ends up in access logs and proxies.
          "x-goog-api-key": key,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = (await response.json()) as GeminiResponse;

      if (!response.ok || data.error) {
        // Google's message describes OUR request, not the key. Truncated so an
        // unexpected body cannot bloat a log line.
        const message = (
          data.error?.message ?? `HTTP ${response.status}`
        ).slice(0, 300);

        log.warn("Gemini request failed", {
          status: response.status,
          message,
        });

        throw new Error(`The AI service refused the request: ${message}`);
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("The AI request timed out.");
      }

      // Re-thrown as-is when it is already our own sanitised error; otherwise
      // replaced, because a raw fetch failure can contain the request URL.
      if (error instanceof Error && error.message.startsWith("The AI ")) {
        throw error;
      }

      log.warn("Gemini request errored");
      throw new Error("The AI service could not be reached.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
