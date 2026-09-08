// spawn_subagent (#85030): the parent turn's tool call spawns a sub-agent turn that
// inherits the parent's tool registry, runs in its own session, is time-boxed by
// agent.subagentTimeoutSec, and returns its final answer as the tool result. Nesting
// is capped at depth 1. Mock provider with scripted completions — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { createBuiltinToolRegistry } from "../dist/core/tools/builtins/index.js";

function scriptedProvider() {
  const calls = [];
  const resolvers = [];
  return {
    provider: {
      name: "fake",
      complete: async (request) => {
        calls.push(request.messages);
        return await new Promise((resolve) => resolvers.push(resolve));
      },
    },
    calls,
    get pending() {
      return resolvers.length;
    },
    release(index, response) {
      const resolve = resolvers[index];
      if (resolve === undefined) throw new Error(`no held completion at index ${index}`);
      resolve(response);
    },
  };
}

function baseConfig(extraAgent = {}) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [] },
      api: { enabled: true },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12, ...extraAgent },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

const inbound = (chatId, text) => ({
  channel: "api",
  senderId: "tester",
  chatId,
  text,
  receivedAt: Date.now(),
});

async function waitFor(predicate, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

test("spawn_subagent: the sub-turn inherits the registry and answers back as a tool result", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig(),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "delegate a sub-task"));
    assert.equal(held.pending, 1);

    held.release(0, {
      text: "",
      toolCalls: [{ id: "call-1", name: "spawn_subagent", arguments: { task: "Reply with exactly: SUB-OK" } }],
      stopReason: "tool_use",
    });
    assert.ok(await waitFor(() => held.pending === 2), "the spawned sub-turn called the provider");

    // The sub-turn's context: its own system prompt and ONLY its task — the parent
    // conversation does not leak in, and it is a different session id.
    const subCall = held.calls[1];
    assert.equal(subCall[0].role, "system");
    assert.deepEqual(
      subCall.filter((message) => message.role === "user").map((message) => message.content),
      ["Reply with exactly: SUB-OK"],
    );

    held.release(1, { text: "SUB-OK", toolCalls: [], stopReason: "final_answer" });
    assert.ok(await waitFor(() => held.pending === 3), "the parent continued after the sub-turn finished");
    held.release(2, { text: "parent done", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "parent done");

    // Own session id, subagent channel, inspectable transcript.
    const sessions = runtime.agent.sessions.list(50);
    const sub = sessions.find((session) => session.id.startsWith("api:c1#subagent-"));
    assert.ok(sub, "the sub-turn has its own session");
    assert.equal(sub.channel, "subagent");
    const subHistory = runtime.agent.sessions.history(sub.id);
    assert.ok(subHistory.some((message) => message.role === "user" && message.content === "Reply with exactly: SUB-OK"));
    assert.ok(subHistory.some((message) => message.role === "assistant" && message.content === "SUB-OK"));

    // The parent's history carries the result as a tool result — never as a user turn.
    const parentHistory = runtime.agent.sessions.history("api:c1");
    const toolResult = parentHistory.find((message) => message.role === "tool");
    assert.ok(toolResult, "the parent recorded a tool result");
    assert.match(toolResult.content, /SUB-OK/);
    assert.match(toolResult.content, /\[sub-agent api:c1#subagent-/);
    assert.ok(!parentHistory.some((message) => message.role === "user" && message.content.includes("Reply with exactly")));
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});

test("spawn_subagent: nesting is capped at depth 1", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig(),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "try nesting"));
    held.release(0, {
      text: "",
      toolCalls: [{ id: "call-1", name: "spawn_subagent", arguments: { task: "try to spawn again" } }],
      stopReason: "tool_use",
    });
    assert.ok(await waitFor(() => held.pending === 2));

    // The sub-agent (already depth 1) tries to spawn its own sub-agent.
    held.release(1, {
      text: "",
      toolCalls: [{ id: "call-2", name: "spawn_subagent", arguments: { task: "nested" } }],
      stopReason: "tool_use",
    });
    assert.ok(await waitFor(() => held.pending === 3), "the refusal loops back into the sub-turn");
    held.release(2, { text: "nested refused", toolCalls: [], stopReason: "final_answer" });
    assert.ok(await waitFor(() => held.pending === 4));
    held.release(3, { text: "parent done", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "parent done");

    const sessions = runtime.agent.sessions.list(50);
    const sub = sessions.find((session) => session.id.startsWith("api:c1#subagent-"));
    const subHistory = runtime.agent.sessions.history(sub.id);
    const refusal = subHistory.find((message) => message.role === "tool");
    assert.ok(refusal, "the nested attempt produced a tool result in the sub session");
    assert.match(refusal.content, /max depth 1/);
    assert.ok(!sessions.some((session) => session.id.includes("#subagent-") && session.id.includes("#subagent-", 12)),
      "no grand-child session was created");
  } finally {
    runtime.close();
  }
});

test("spawn_subagent: the sub-turn is time-boxed by agent.subagentTimeoutSec", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig({ subagentTimeoutSec: 5 }),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "hang the sub-turn"));
    held.release(0, {
      text: "",
      toolCalls: [{ id: "call-1", name: "spawn_subagent", arguments: { task: "never answers" } }],
      stopReason: "tool_use",
    });
    // resolvers[1] = the sub-turn's provider call — never released. The sub-turn's
    // 5s budget must abort it, return the abort as the tool result, and unblock the
    // parent loop (resolvers[2] = the parent's next provider call).
    assert.ok(await waitFor(() => held.pending === 3, 12_000), "the parent loop continued after the time box");
    held.release(2, { text: "parent done", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "parent done");

    const parentHistory = runtime.agent.sessions.history("api:c1");
    const toolResult = parentHistory.find((message) => message.role === "tool");
    assert.match(toolResult.content, /exceeded its 5000ms budget/);
  } finally {
    runtime.close();
  }
});

test("spawn_subagent outside an agent loop refuses cleanly", async () => {
  const registry = createBuiltinToolRegistry(baseConfig());
  const tool = registry.get("spawn_subagent");
  assert.ok(tool, "spawn_subagent ships in the built-in registry");
  const result = await tool.execute({ task: "anything" }, { sessionId: "s", workdir: tmpdir() });
  assert.equal(result.ok, false);
  assert.match(result.output, /unavailable/);
  const empty = await tool.execute({}, { sessionId: "s", workdir: tmpdir(), subagent: undefined });
  assert.match(empty.output, /unavailable/);
});