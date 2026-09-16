import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";

import { GeminiProvider } from "@/services/ai/gemini.provider";

/**
 * What actually reaches Gemini.
 *
 * These exist because of a real outage: Zod 4 emits a `$schema` declaration
 * when converting a tool's parameters to JSON Schema, and Gemini's
 * `parameters` field is NOT JSON Schema — it is a subset of the OpenAPI 3
 * schema object. An unknown keyword is a hard 400 for the ENTIRE request, so
 * one declaration took down all 45 tools at once and every message came back
 * as "Something went wrong".
 *
 * Nothing caught it. The registry's own tests assert correct JSON Schema, and
 * it WAS correct — the defect lived in the gap between a valid schema and one
 * vendor's dialect. So these assert on the serialised request body, which is
 * the only place that gap is visible.
 */

/** Captures the body of the single fetch the provider performs. */
function captureRequestBody(): () => Record<string, unknown> {
  let captured: Record<string, unknown> | null = null;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );

  return () => {
    if (!captured) {
      throw new Error("fetch was never called");
    }

    return captured;
  };
}

/** A tool whose schema exercises the keywords Gemini rejects. */
const tool = {
  name: "create_task",
  description: "Create a task",
  parameters: z.toJSONSchema(
    z.object({
      title: z.string().describe("What to do"),
      priority: z.enum(["LOW", "HIGH"]).optional(),
    }),
    { io: "input", unrepresentable: "any" },
  ) as Record<string, unknown>,
};

describe("the Gemini request body", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-not-a-real-one");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("the tool schema Zod produces really does contain $schema", () => {
    // Guards the premise. If Zod stops emitting this, the stripping below is
    // still harmless, but this test should be the one that tells us why.
    expect(tool.parameters).toHaveProperty("$schema");
  });

  test("carries no keyword Gemini would reject", async () => {
    const body = captureRequestBody();

    await new GeminiProvider().complete({
      messages: [{ role: "user", content: "Add a task" }],
      tools: [tool],
    });

    const serialised = JSON.stringify(body());

    for (const keyword of [
      "$schema",
      "$ref",
      "$defs",
      "additionalProperties",
    ]) {
      expect(serialised).not.toContain(`"${keyword}"`);
    }
  });

  test("still describes the tool, so stripping did not gut the schema", async () => {
    const body = captureRequestBody();

    await new GeminiProvider().complete({
      messages: [{ role: "user", content: "Add a task" }],
      tools: [tool],
    });

    const declaration = (
      body().tools as { functionDeclarations: unknown[] }[]
    )[0]!.functionDeclarations[0] as {
      name: string;
      parameters: {
        type: string;
        required: string[];
        properties: Record<string, { type: string; description?: string }>;
      };
    };

    expect(declaration.name).toBe("create_task");
    expect(declaration.parameters.type).toBe("object");
    expect(declaration.parameters.required).toEqual(["title"]);

    // The parts the model needs to call the tool correctly survive.
    expect(declaration.parameters.properties.title?.type).toBe("string");
    expect(declaration.parameters.properties.title?.description).toBe(
      "What to do",
    );
    expect(declaration.parameters.properties.priority).toBeDefined();
  });
});
