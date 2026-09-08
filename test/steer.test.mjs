// Steer mode (#48003): mid-turn messages are appended into the running turn's
// session (channels.telegram.steerMode = "inject", default) instead of queueing a
// second turn; "queue" keeps the classic serialized behavior; slash commands always
// queue. Mock provider with held completions — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

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

function baseConfig(steerMode) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: {
        enabled: false,
        botToken: "unit-test-token",
        allowedSenders: [],
        mediaDir: tmpdir(),
        ...(steerMode === undefined ? {} : { steerMode }),
      },
      api: { enabled: true },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
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

async function waitFor(predicate, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

test("steer inject (explicit): mid-turn additions join the running turn's context", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig("inject"),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "start the turn"));
    assert.equal(held.pending, 1);

    const p2 = runtime.handleMessage(inbound("c1", "actually also do X"));
    assert.equal((await p2).text, "", "steered message acks immediately with an empty reply");
    assert.equal(held.pending, 1, "no second provider call was spawned for the steered message");

    held.release(0, { text: "", toolCalls: [{ id: "t1", name: "no_such_tool", arguments: {} }], stopReason: "tool_use" });
    assert.ok(await waitFor(() => held.pending === 2), "the loop continues after the tool result");
    const secondCall = held.calls[1];
    assert.ok(
      secondCall.some((message) => message.role === "user" && message.content === "actually also do X"),
      "the steered text is part of the next provider call's context",
    );

    held.release(1, { text: "final", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "final");

    const history = runtime.agent.sessions.history("api:c1");
    assert.ok(history.some((message) => message.role === "user" && message.content === "actually also do X"));
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});

test("steer mode defaults to inject when the config key is absent", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig(undefined),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "start"));
    assert.equal(held.pending, 1);
    const p2 = runtime.handleMessage(inbound("c1", "steered addition"));
    const start = Date.now();
    assert.equal((await p2).text, "");
    assert.ok(Date.now() - start < 200, "default inject resolves the steered message without queueing");
    held.release(0, { text: "done", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "done");
  } finally {
    runtime.close();
  }
});

test("steer queue: mid-turn messages keep the classic serialized queue", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig("queue"),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "first"));
    const p2 = runtime.handleMessage(inbound("c1", "second"));
    assert.equal(held.pending, 1, "queue mode does not start the second turn early");

    held.release(0, { text: "reply-1", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "reply-1");
    assert.ok(await waitFor(() => held.pending === 2), "the queued message runs after the first turn");
    assert.ok(
      held.calls[1].filter((message) => message.role === "user").some((message) => message.content === "second"),
      "the queued message runs as its own turn, not an injection",
    );
    held.release(1, { text: "reply-2", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p2).text, "reply-2");
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});

test("slash commands queue instead of steering, even in inject mode", async () => {
  const held = scriptedProvider();
  const runtime = buildRuntime({
    config: baseConfig("inject"),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "busy work"));
    assert.equal(held.pending, 1);
    const p2 = runtime.handleMessage(inbound("c1", "/reset"));
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(held.pending, 1, "the command neither steered nor started a provider call");
    const settled = await Promise.race([
      p2.then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 15)),
    ]);
    assert.equal(settled, "pending", "the command waits in the queue");

    held.release(0, { text: "reply-1", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p1).text, "reply-1");
    assert.ok(await waitFor(() => held.pending === 2));
    held.release(1, { text: "reply-2", toolCalls: [], stopReason: "final_answer" });
    assert.equal((await p2).text, "reply-2");
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});