// Watchdog + turn-budget tests (#68596) — mock providers, no network.
// Verifies: a hung provider call is aborted by llm.watchdogTimeoutSec, the whole
// turn is bounded by llm.turnTimeoutMs, and tool runs are cut by the remaining
// budget — each ending with a user-visible error reply persisted to the session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { ToolRegistry } from "../dist/core/tools/registry.js";
import { runAgentTurn } from "../dist/core/agent.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRuntime(step, llm) {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  const tools = new ToolRegistry();
  tools.register({
    name: "slow_echo",
    description: "echoes text back after a long delay",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "text to echo" } },
      required: ["text"],
    },
    execute: async (input) => {
      await sleep(3_000);
      return { ok: true, output: String(input.text) };
    },
  });
  const provider = {
    name: "fake",
    complete: async (request) => {
      // The mock ignores request.signal on purpose: the loop must cut providers
      // that never honor the watchdog cancellation signal.
      if (typeof step === "function") return step(request);
      return step;
    },
  };
  const config = {
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 6 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    ...(llm === undefined ? {} : { llm }),
  };
  return { runtime: { config, provider, tools, sessions }, sessions };
}

const FINAL = { text: "done", toolCalls: [], stopReason: "final_answer" };
const TOOL_STEP = {
  text: "",
  toolCalls: [{ id: "c1", name: "slow_echo", arguments: { text: "hi" } }],
  stopReason: "tool_use",
};

test("watchdog aborts a provider call that never completes", async () => {
  const { runtime, sessions } = makeRuntime(() => new Promise(() => {}), { watchdogTimeoutSec: 1 });
  const result = await runAgentTurn({ sessionId: "wd:s1", text: "hang forever" }, runtime);
  assert.equal(result.stopReason, "error");
  assert.ok(result.reply.includes("stalled"), `reply was: ${result.reply}`);
  assert.ok(result.reply.includes("watchdog"));
  // The abort is persisted so the next turn has context.
  const last = sessions.history("wd:s1").at(-1);
  assert.equal(last.role, "assistant");
  assert.ok(last.content.includes("stalled"));
});

test("turn budget aborts a turn whose provider call drags past the deadline", async () => {
  const { runtime } = makeRuntime(async () => {
    await sleep(3_000);
    return FINAL;
  }, { turnTimeoutMs: 1_000 });
  const result = await runAgentTurn({ sessionId: "wd:s2", text: "too slow" }, runtime);
  assert.equal(result.stopReason, "error");
  assert.ok(result.reply.includes("budget"), `reply was: ${result.reply}`);
  assert.ok(result.reply.includes("llm.turnTimeoutMs"));
});

test("turn budget cuts a stalled tool run and ends the turn cleanly", async () => {
  const { runtime } = makeRuntime(TOOL_STEP, { turnTimeoutMs: 1_000 });
  const result = await runAgentTurn({ sessionId: "wd:s3", text: "tool too slow" }, runtime);
  assert.equal(result.stopReason, "error");
  assert.ok(result.reply.includes("budget"), `reply was: ${result.reply}`);
});