// Busy handling: per-chat serialized turns with a bounded queue. Messages queue
// while a turn is in flight; a full queue is refused with BusyTurnError, which
// channels translate into a Telegram notice or HTTP 429. Mock provider with held
// completions — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { BusyTurnError } from "../dist/gateway/channels/types.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function baseConfig(busyQueueLimit, apiToken = "unit-test-token") {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken, busyQueueLimit },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [], mediaDir: tmpdir() },
      api: { enabled: true },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

function heldProvider() {
  const resolvers = [];
  const prompts = [];
  return {
    provider: {
      name: "fake",
      complete: async (request) => {
        prompts.push(request.messages[request.messages.length - 1]?.content ?? "");
        return await new Promise((resolve) => resolvers.push(resolve));
      },
    },
    prompts,
    get pending() {
      return resolvers.length;
    },
    release(index, text) {
      const resolve = resolvers[index];
      if (resolve === undefined) throw new Error(`no held completion at index ${index}`);
      resolve({ text, toolCalls: [], stopReason: "final_answer" });
    },
  };
}

const inbound = (chatId, text) => ({
  channel: "api",
  senderId: "tester",
  chatId,
  text,
  receivedAt: Date.now(),
});

test("same-chat messages serialize; replies keep arrival order", async () => {
  const held = heldProvider();
  const runtime = buildRuntime({
    config: baseConfig(10),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "first"));
    const p2 = runtime.handleMessage(inbound("c1", "second"));
    assert.equal(held.pending, 1); // only the first turn is in flight

    held.release(0, "reply-1");
    assert.equal((await p1).text, "reply-1");
    assert.equal(held.pending, 2); // second turn started after the first finished
    assert.equal(held.prompts[0], "first");
    assert.equal(held.prompts[1], "second");

    held.release(1, "reply-2");
    assert.equal((await p2).text, "reply-2");
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});

test("a full queue refuses further messages with BusyTurnError", async () => {
  const held = heldProvider();
  const runtime = buildRuntime({
    config: baseConfig(1),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "first"));
    const p2 = runtime.handleMessage(inbound("c1", "second"));
    assert.equal(held.pending, 1);
    const p3 = runtime.handleMessage(inbound("c1", "third"));
    await assert.rejects(p3, (error) => error instanceof BusyTurnError && error.queueLimit === 1);

    held.release(0, "one");
    await p1;
    held.release(1, "two");
    assert.equal((await p2).text, "two"); // the queued message still ran
    assert.ok(await runtime.waitUntilIdle(1_000));
  } finally {
    runtime.close();
  }
});

test("other chats keep their own queue and run concurrently", async () => {
  const held = heldProvider();
  const runtime = buildRuntime({
    config: baseConfig(1),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  try {
    const p1 = runtime.handleMessage(inbound("c1", "first"));
    const pOther = runtime.handleMessage(inbound("c2", "other"));
    assert.equal(held.pending, 2); // different chats run at once

    held.release(1, "other-reply");
    assert.equal((await pOther).text, "other-reply");
    held.release(0, "one");
    await p1;
  } finally {
    runtime.close();
  }
});

test("api channel answers 429 when the busy queue is full", async () => {
  delete process.env.CARAPACE_API_TOKEN;
  const held = heldProvider();
  const runtime = buildRuntime({
    config: baseConfig(1, { env: "CARAPACE_API_TOKEN" }),
    provider: held.provider,
    store: new CarapaceStore(":memory:"),
  });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  try {
    const url = `http://127.0.0.1:${handle.port}/api/v1/messages`;
    const post = (text) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senderId: "tester", text }),
      });
    const inFlight = post("first");
    await new Promise((r) => setTimeout(r, 50)); // let the first turn reach the gate
    const queued = post("second"); // occupies the single queue slot (waits, no response yet)
    await new Promise((r) => setTimeout(r, 50));
    const busy = await post("third"); // queue is full → refused
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).error, "busy");

    held.release(0, "late reply");
    assert.equal((await inFlight).status, 200);
    held.release(1, "second reply");
    assert.equal((await queued).status, 200);
  } finally {
    await handle.stop();
    runtime.close();
  }
});