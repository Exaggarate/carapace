// M11 error UX: provider failures become friendly one-liners (no raw dumps),
// watchdog/budget texts pass through untouched, and fallback-served turns
// surface gracefully with a short footer. Mock providers — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { runAgentTurn, LlmError } from "../dist/core/agent.js";
import { FallbackProvider } from "../dist/core/llm/providers/fallback.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";

function makeRuntime(provider) {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  return {
    runtime: {
      config: {
        agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
        tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
      },
      provider,
      tools: new ToolRegistry(),
      sessions,
    },
    sessions,
  };
}

const OK = { text: "done", toolCalls: [], stopReason: "final_answer" };

test("provider failure replies with a friendly one-liner, never a raw dump", async () => {
  const provider = {
    name: "openai",
    complete: async () => {
      throw new LlmError("all providers failed — openai: HTTP 429 rate limited | anthropic: HTTP 500 oops");
    },
  };
  const { runtime, sessions } = makeRuntime(provider);
  const result = await runAgentTurn({ sessionId: "telegram:1", text: "hi", channel: "telegram" }, runtime);
  assert.equal(result.stopReason, "error");
  assert.ok(result.reply.startsWith("🦞 brain hiccup"), `reply: ${result.reply}`);
  assert.ok(result.reply.includes("fallback"));
  assert.ok(!result.reply.includes("HTTP 429"), "no raw dump in the reply");
  const last = sessions.history("telegram:1").at(-1);
  assert.equal(last.role, "assistant");
  assert.ok(last.content.startsWith("🦞 brain hiccup"), "the friendly line is what persists");
});

test("watchdog and budget texts still pass through untouched", async () => {
  const watchdog = {
    name: "openai",
    complete: async () => {
      throw new LlmError(
        "the model stalled — no response within 5s, so the turn was aborted (llm.watchdogTimeoutSec); try again or raise the limit",
      );
    },
  };
  const { runtime } = makeRuntime(watchdog);
  const result = await runAgentTurn({ sessionId: "s", text: "hi" }, runtime);
  assert.ok(result.reply.includes("stalled"));
  assert.ok(result.reply.includes("llm.watchdogTimeoutSec"));

  const budget = {
    name: "openai",
    complete: async () => {
      throw new LlmError(
        "the turn exceeded its 5000ms budget and was aborted (llm.turnTimeoutMs); narrow the request or raise the limit",
      );
    },
  };
  const { runtime: runtime2 } = makeRuntime(budget);
  const result2 = await runAgentTurn({ sessionId: "s2", text: "hi" }, runtime2);
  assert.ok(result2.reply.includes("llm.turnTimeoutMs"));
});

test("a turn served by a fallback provider carries a graceful footer", async () => {
  const failing = {
    name: "openai",
    complete: async () => {
      throw new LlmError("HTTP 503");
    },
  };
  const working = { name: "ollama", complete: async () => OK };
  const provider = new FallbackProvider([failing, working], () => {});
  const { runtime, sessions } = makeRuntime(provider);
  const result = await runAgentTurn({ sessionId: "telegram:2", text: "hi", channel: "telegram" }, runtime);
  assert.equal(result.stopReason, "final_answer");
  assert.ok(result.reply.startsWith("done"), `reply: ${result.reply}`);
  assert.ok(result.reply.includes("— 🦞 served by a fallback provider after the primary failed."));
  // The persisted history keeps the clean answer — the footer is transport metadata.
  const last = sessions.history("telegram:2").at(-1);
  assert.equal(last.content, "done");
});

test("a primary-served turn carries no footer", async () => {
  const primary = { name: "openai", complete: async () => OK };
  const provider = new FallbackProvider([primary], () => {});
  const { runtime } = makeRuntime(provider);
  const result = await runAgentTurn({ sessionId: "telegram:3", text: "hi" }, runtime);
  assert.equal(result.reply, "done");
});