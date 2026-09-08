// announceTarget completion-routing tests (#27445) — mock telegram transport, no network.
// Verifies: a turn from a different chat routes its full reply to the configured
// target chat and sends the origin a short notice; same-chat turns and
// push-incapable targets degrade to replying in place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function baseConfig(announceTarget) {
  return {
    gateway: { host: "127.0.0.1", port: 8899, apiToken: null, busyQueueLimit: 5 },
    llm: {
      baseURL: "http://127.0.0.1:1/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 1_000,
      turnTimeoutMs: 600_000,
      watchdogTimeoutSec: 300,
    },
    channels: {
      telegram: { enabled: true, botToken: "test-token", allowedSenders: [], mediaDir: `${tmpdir()}/media` },
      api: { enabled: true },
    },
    agent: { systemPrompt: "s", maxToolIterations: 3, announceTarget },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: `${tmpdir()}/announce.db` },
  };
}

async function makeRuntime(announceTarget) {
  const sendMessageCalls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    if (url.includes("/sendMessage")) {
      sendMessageCalls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, result: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({
    config: baseConfig(announceTarget),
    store,
    provider: {
      name: "fake",
      complete: async () => ({ text: "the full answer", toolCalls: [], stopReason: "final_answer" }),
    },
    telegramOptions: { fetchImpl, log: () => {} },
  });
  return { runtime, sendMessageCalls };
}

const MSG = (overrides = {}) => ({
  channel: "api",
  senderId: "tester",
  chatId: "tester",
  text: "hello",
  receivedAt: Date.now(),
  ...overrides,
});

test("announceTarget routes the full reply to the target chat and notifies the origin", async () => {
  const { runtime, sendMessageCalls } = await makeRuntime({ channel: "telegram", chatId: "999" });
  const reply = await runtime.handleMessage(MSG());
  assert.ok(reply.text.includes("routed to telegram:999"), `notice was: ${reply.text}`);
  assert.ok(!reply.text.includes("the full answer"));
  await runtime.waitUntilIdle();
  assert.equal(sendMessageCalls.length, 1);
  const body = JSON.parse(sendMessageCalls[0].init.body);
  assert.equal(body.chat_id, "999");
  assert.equal(body.text, "the full answer");
  runtime.close();
});

test("origin chat equal to the target gets the reply directly (no double-send)", async () => {
  const { runtime, sendMessageCalls } = await makeRuntime({ channel: "api", chatId: "tester" });
  const reply = await runtime.handleMessage(MSG());
  assert.equal(reply.text, "the full answer");
  await runtime.waitUntilIdle();
  assert.equal(sendMessageCalls.length, 0);
  runtime.close();
});

test("announceTarget to a push-incapable channel degrades to an in-place reply", async () => {
  const { runtime, sendMessageCalls } = await makeRuntime({ channel: "api", chatId: "elsewhere" });
  const reply = await runtime.handleMessage(MSG());
  assert.equal(reply.text, "the full answer");
  await runtime.waitUntilIdle();
  assert.equal(sendMessageCalls.length, 0);
  runtime.close();
});

test("unknown announceTarget channel degrades to an in-place reply", async () => {
  const { runtime, sendMessageCalls } = await makeRuntime({ channel: "discord", chatId: "x" });
  const reply = await runtime.handleMessage(MSG());
  assert.equal(reply.text, "the full answer");
  await runtime.waitUntilIdle();
  assert.equal(sendMessageCalls.length, 0);
  runtime.close();
});