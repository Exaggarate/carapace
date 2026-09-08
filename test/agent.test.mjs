// Agent-loop tests with a MOCK LLM provider — no network, no real model.
// Verifies: tool-call loop end-to-end, error handling, iteration cap, persistence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { ToolRegistry } from "../dist/core/tools/registry.js";
import { runAgentTurn, LlmError } from "../dist/core/agent.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";

function makeRuntime(script, { maxToolIterations = 12 } = {}) {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echoes text back",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "text to echo" } },
      required: ["text"],
    },
    execute: async (input) => ({ ok: true, output: String(input.text) }),
  });
  const calls = [];
  const provider = {
    name: "fake",
    complete: async (request) => {
      calls.push({
        messages: request.messages.map((m) => ({ role: m.role, content: m.content, toolCallId: m.toolCallId })),
        tools: request.tools.map((t) => t.function.name),
      });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      if (typeof step === "function") return step();
      return step;
    },
  };
  const config = {
    agent: { systemPrompt: "You are a test agent.", maxToolIterations },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
  };
  return { runtime: { config, provider, tools, sessions }, sessions, calls, store };
}

const TOOL_STEP = {
  text: "",
  toolCalls: [{ id: "c1", name: "echo", arguments: { text: "hi" } }],
  stopReason: "tool_use",
};

test("tool-call loop runs end-to-end with a mock provider", async () => {
  const { runtime, sessions, calls } = makeRuntime([
    TOOL_STEP,
    { text: "echoed: hi", toolCalls: [], stopReason: "final_answer" },
  ]);

  const result = await runAgentTurn({ sessionId: "test:s1", text: "say hi via tool", channel: "test" }, runtime);

  assert.equal(result.stopReason, "final_answer");
  assert.equal(result.iterations, 2);
  assert.equal(result.toolCallsExecuted, 1);
  assert.equal(result.reply, "echoed: hi");

  // The second provider call must carry the tool result back to the model.
  const secondCall = calls[1];
  assert.ok(secondCall.messages.some((m) => m.role === "tool" && m.toolCallId === "c1" && m.content === "hi"));
  // Tools are offered on every call.
  assert.ok(calls[0].tools.includes("echo"));

  // Persisted history: user, assistant(toolCalls), tool, assistant.
  const history = sessions.history("test:s1");
  assert.equal(history.length, 4);
  assert.deepEqual(history[0].role, "user");
  assert.equal(history[1].toolCalls?.[0]?.id, "c1");
  assert.equal(history[2].toolCallId, "c1");
  assert.equal(history[2].toolName, "echo");
  assert.equal(history[3].content, "echoed: hi");
});

test("unknown tool becomes a tool result instead of a crash", async () => {
  const { runtime, sessions } = makeRuntime([
    { text: "", toolCalls: [{ id: "c1", name: "nope", arguments: {} }], stopReason: "tool_use" },
    { text: "recovered", toolCalls: [], stopReason: "final_answer" },
  ]);
  const result = await runAgentTurn({ sessionId: "test:s2", text: "call something missing" }, runtime);
  assert.equal(result.stopReason, "final_answer");
  assert.equal(result.toolCallsExecuted, 1);
  const toolMsg = sessions.history("test:s2").find((m) => m.role === "tool");
  assert.ok(toolMsg.content.includes('unknown tool "nope"'));
});

test("malformed arguments are reported back to the model", async () => {
  const { runtime, sessions } = makeRuntime([
    {
      text: "",
      toolCalls: [{ id: "c1", name: "echo", arguments: {}, argumentsError: "Unexpected token } in JSON" }],
      stopReason: "tool_use",
    },
    { text: "ok", toolCalls: [], stopReason: "final_answer" },
  ]);
  await runAgentTurn({ sessionId: "test:s3", text: "bad args" }, runtime);
  const toolMsg = sessions.history("test:s3").find((m) => m.role === "tool");
  assert.ok(toolMsg.content.includes("not valid JSON"));
});

test("missing required arguments are reported back to the model", async () => {
  const { runtime, sessions } = makeRuntime([
    { text: "", toolCalls: [{ id: "c1", name: "echo", arguments: {} }], stopReason: "tool_use" },
    { text: "ok", toolCalls: [], stopReason: "final_answer" },
  ]);
  await runAgentTurn({ sessionId: "test:s4", text: "no args" }, runtime);
  const toolMsg = sessions.history("test:s4").find((m) => m.role === "tool");
  assert.ok(toolMsg.content.includes("missing required argument(s): text"));
});

test("loop stops at maxToolIterations with stopReason max_iterations", async () => {
  const { runtime } = makeRuntime([TOOL_STEP], { maxToolIterations: 2 });
  const result = await runAgentTurn({ sessionId: "test:s5", text: "loop forever" }, runtime);
  assert.equal(result.stopReason, "max_iterations");
  assert.equal(result.iterations, 2);
  assert.equal(result.toolCallsExecuted, 2);
});

test("provider failures surface as a friendly one-liner with stopReason error", async () => {
  const { runtime, sessions } = makeRuntime([() => { throw new LlmError("boom"); }]);
  const result = await runAgentTurn({ sessionId: "test:s6", text: "make it fail" }, runtime);
  assert.equal(result.stopReason, "error");
  assert.ok(result.reply.startsWith("🦞 brain hiccup"), `reply: ${result.reply}`);
  assert.ok(!result.reply.includes("boom"), "no raw dump in the user-facing reply");
  // The friendly line is persisted so the next turn has context.
  const last = sessions.history("test:s6").at(-1);
  assert.equal(last.role, "assistant");
  assert.ok(last.content.startsWith("🦞 brain hiccup"));
});