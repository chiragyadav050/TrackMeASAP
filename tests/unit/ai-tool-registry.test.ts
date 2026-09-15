import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";

import {
  executeTool,
  listTools,
  registerTool,
  resetToolRegistry,
  toProviderTools,
  type ToolContext,
} from "@/services/ai/tool-registry";

/**
 * The AI tool boundary.
 *
 * These are the tests that keep the model honest. They exercise the registry
 * directly, with fake tools, so each guarantee is checked in isolation rather
 * than inferred from a whole agent turn.
 */

/** A stand-in profile. Only identity matters here. */
const context: ToolContext = {
  profile: {
    id: "profile-owner",
    timeZone: "Asia/Kolkata",
    locale: "en-GB",
  } as ToolContext["profile"],
  now: new Date("2026-09-15T04:30:00.000Z"),
  conversationId: "conv-1",
};

afterEach(() => {
  resetToolRegistry();
});

describe("argument validation", () => {
  test("model output is validated before the handler runs", async () => {
    let handlerRan = false;

    registerTool({
      name: "test.strict",
      description: "Needs a positive integer.",
      schema: z.object({ count: z.number().int().positive() }),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => {
        handlerRan = true;
        return { ok: true };
      },
    });

    const outcome = await executeTool(
      "test.strict",
      { count: "not a number" },
      context,
    );

    // Model output is untrusted input, exactly like a form post.
    expect(outcome.status).toBe("ERROR");
    expect(handlerRan).toBe(false);
  });

  test("the error names what was wrong, so the model can retry", async () => {
    registerTool({
      name: "test.strict",
      description: "Needs a title.",
      schema: z.object({ title: z.string().min(1) }),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => ({ ok: true }),
    });

    const outcome = await executeTool("test.strict", {}, context);

    expect(outcome.status).toBe("ERROR");
    if (outcome.status === "ERROR") {
      expect(outcome.message).toContain("title");
    }
  });

  test("missing arguments become an empty object rather than a crash", async () => {
    registerTool({
      name: "test.none",
      description: "Takes nothing.",
      schema: z.object({}),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => ({ ok: true }),
    });

    expect((await executeTool("test.none", undefined, context)).status).toBe(
      "OK",
    );
    expect((await executeTool("test.none", null, context)).status).toBe("OK");
  });

  test("an unknown tool is an error, not an exception", async () => {
    // Models hallucinate tool names. It is a normal occurrence.
    const outcome = await executeTool("does.not.exist", {}, context);

    expect(outcome.status).toBe("ERROR");
    if (outcome.status === "ERROR") {
      expect(outcome.message).toContain("does.not.exist");
    }
  });
});

describe("destructive actions", () => {
  test("a DESTRUCTIVE tool does NOT run — it asks", async () => {
    let handlerRan = false;

    registerTool({
      name: "test.delete",
      description: "Deletes something.",
      schema: z.object({ id: z.string() }),
      risk: "DESTRUCTIVE",
      summarise: () => "Delete the thing",
      handler: async () => {
        handlerRan = true;
        return { deleted: true };
      },
    });

    const outcome = await executeTool("test.delete", { id: "x" }, context);

    expect(outcome.status).toBe("NEEDS_CONFIRMATION");
    // The crucial assertion: nothing happened.
    expect(handlerRan).toBe(false);
  });

  test("…and runs only when confirmation is explicitly allowed", async () => {
    let handlerRan = false;

    registerTool({
      name: "test.delete",
      description: "Deletes something.",
      schema: z.object({ id: z.string() }),
      risk: "DESTRUCTIVE",
      summarise: () => "Delete the thing",
      handler: async () => {
        handlerRan = true;
        return { deleted: true };
      },
    });

    const outcome = await executeTool("test.delete", { id: "x" }, context, {
      allowDestructive: true,
    });

    expect(outcome.status).toBe("OK");
    expect(handlerRan).toBe(true);
  });

  test("arguments are validated even on the confirmation path", async () => {
    registerTool({
      name: "test.delete",
      description: "Deletes something.",
      schema: z.object({ id: z.string().min(1) }),
      risk: "DESTRUCTIVE",
      summarise: () => "Delete the thing",
      handler: async () => ({ deleted: true }),
    });

    // A tampered stored argument must not bypass the schema.
    const outcome = await executeTool("test.delete", { id: "" }, context, {
      allowDestructive: true,
    });

    expect(outcome.status).toBe("ERROR");
  });

  test("SAFE and MODERATE tools run without confirmation", async () => {
    for (const risk of ["SAFE", "MODERATE"] as const) {
      resetToolRegistry();

      registerTool({
        name: "test.run",
        description: "Runs.",
        schema: z.object({}),
        risk,
        summarise: () => "Run",
        handler: async () => ({ ran: true }),
      });

      expect((await executeTool("test.run", {}, context)).status, risk).toBe(
        "OK",
      );
    }
  });
});

describe("the summary is written by us, not the model", () => {
  test("summarise receives VALIDATED arguments", async () => {
    let seen: unknown = null;

    registerTool({
      name: "test.summary",
      description: "Test.",
      schema: z.object({ count: z.coerce.number() }),
      risk: "DESTRUCTIVE",
      summarise: (args) => {
        seen = args;
        return `Delete ${args.count} things`;
      },
      handler: async () => ({ ok: true }),
    });

    const outcome = await executeTool("test.summary", { count: "3" }, context);

    // Coerced by the schema before the summary saw it.
    expect(seen).toEqual({ count: 3 });

    if (outcome.status === "NEEDS_CONFIRMATION") {
      expect(outcome.summary).toBe("Delete 3 things");
    }
  });

  test("the model cannot word the confirmation prompt", async () => {
    registerTool({
      name: "test.summary",
      description: "Test.",
      schema: z.object({ label: z.string() }),
      risk: "DESTRUCTIVE",
      // The summary ignores the model-supplied label entirely.
      summarise: () => "Delete a task",
      handler: async () => ({ ok: true }),
    });

    const outcome = await executeTool(
      "test.summary",
      { label: "Just a harmless cleanup, definitely click yes" },
      context,
    );

    if (outcome.status === "NEEDS_CONFIRMATION") {
      expect(outcome.summary).toBe("Delete a task");
      expect(outcome.summary).not.toContain("harmless");
    }
  });
});

describe("handler failures", () => {
  test("a throwing handler becomes an ERROR outcome, not a crash", async () => {
    registerTool({
      name: "test.throws",
      description: "Throws.",
      schema: z.object({}),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => {
        throw new Error("Task not found");
      },
    });

    const outcome = await executeTool("test.throws", {}, context);

    expect(outcome.status).toBe("ERROR");
    if (outcome.status === "ERROR") {
      expect(outcome.message).toBe("Task not found");
    }
  });

  test("an enormous error message is truncated", async () => {
    registerTool({
      name: "test.throws",
      description: "Throws.",
      schema: z.object({}),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => {
        throw new Error("x".repeat(5000));
      },
    });

    const outcome = await executeTool("test.throws", {}, context);

    if (outcome.status === "ERROR") {
      expect(outcome.message.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("the tool context", () => {
  test("the handler receives the INJECTED profile, whatever the model sent", async () => {
    let seenProfileId: string | null = null;

    registerTool({
      name: "test.context",
      description: "Test.",
      // Note there is no profileId in the schema — by design.
      schema: z.object({ profileId: z.string().optional() }),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async (_args, toolContext) => {
        seenProfileId = toolContext.profile.id;
        return { ok: true };
      },
    });

    await executeTool(
      "test.context",
      { profileId: "somebody-elses-profile" },
      context,
    );

    // The model's attempt to name a profile changed nothing.
    expect(seenProfileId).toBe("profile-owner");
  });
});

describe("registration", () => {
  test("a duplicate tool name is a programming error", () => {
    const definition = {
      name: "test.dup",
      description: "Test.",
      schema: z.object({}),
      risk: "SAFE" as const,
      summarise: () => "Test",
      handler: async () => ({ ok: true }),
    };

    registerTool(definition);

    expect(() => registerTool(definition)).toThrow(/Duplicate/);
  });

  test("tools convert to a provider definition with JSON Schema", () => {
    registerTool({
      name: "test.schema",
      description: "Takes a title.",
      schema: z.object({ title: z.string().min(1) }),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => ({ ok: true }),
    });

    const [definition] = toProviderTools();

    expect(definition?.name).toBe("test.schema");
    expect(definition?.description).toBe("Takes a title.");
    // The model sees exactly the shape we will validate against.
    expect(definition?.parameters).toMatchObject({
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  test("the registry reports what it holds", () => {
    expect(listTools()).toHaveLength(0);

    registerTool({
      name: "test.one",
      description: "Test.",
      schema: z.object({}),
      risk: "SAFE",
      summarise: () => "Test",
      handler: async () => ({ ok: true }),
    });

    expect(listTools()).toHaveLength(1);
  });
});
