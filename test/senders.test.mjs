// Per-sender routing tests (#81271) — mock providers, no network.
// Verifies: allowTools filters the tool specs offered to the model, model overrides
// swap the provider, non-matching senders keep the default provider/toolset, and
// channel-scoped routes only apply on their channel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { resolveSenderRoute, validateConfig } from "../dist/config.js";
import { buildRuntime } from "../dist/gateway/runtime.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function makeProvider(label, calls) {
  return {
    name: label,
    complete: async (request) => {
      calls.push({ label, tools: request.tools.map((t) => t.function.name) });
      return { text: `reply-from-${label}`, toolCalls: [], stopReason: "final_answer" };
    },
  };
}

function configWith(senders) {
  return {
    gateway: { host: "127.0.0.1", port: 8899, apiToken: null, busyQueueLimit: 5 },
    llm: {
      baseURL: "http://127.0.0.1:1/v1",
      apiKey: "test-key",
      model: "default-model",
      timeoutMs: 1_000,
      turnTimeoutMs: 600_000,
      watchdogTimeoutSec: 300,
    },
    channels: {
      telegram: { enabled: false, botToken: "test-token", allowedSenders: [], mediaDir: `${tmpdir()}/media` },
      api: { enabled: true },
    },
    agent: { systemPrompt: "s", maxToolIterations: 3, announceTarget: null },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: `${tmpdir()}/senders.db` },
    senders,
  };
}

const MSG = (overrides = {}) => ({
  channel: "api",
  senderId: "tester",
  chatId: "tester",
  text: "hi",
  receivedAt: Date.now(),
  ...overrides,
});

test("per-sender allowlist filters tools and model override swaps the provider", async () => {
  const defaultCalls = [];
  const overrideCalls = [];
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({
    config: configWith([{ match: "tester", allowTools: ["files"], model: "big-model" }]),
    store,
    provider: makeProvider("default", defaultCalls),
    providerForModel: (model) => makeProvider(`override:${model}`, overrideCalls),
  });
  const reply = await runtime.handleMessage(MSG());
  assert.equal(reply.text, "reply-from-override:big-model");
  assert.equal(defaultCalls.length, 0);
  assert.equal(overrideCalls.length, 1);
  assert.deepEqual(overrideCalls[0].tools, ["files"]);
  runtime.close();
});

test("non-matching senders keep the default provider and the full toolset", async () => {
  const defaultCalls = [];
  const overrideCalls = [];
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({
    config: configWith([{ match: "tester", allowTools: ["files"], model: "big-model" }]),
    store,
    provider: makeProvider("default", defaultCalls),
    providerForModel: (model) => makeProvider(`override:${model}`, overrideCalls),
  });
  const reply = await runtime.handleMessage(MSG({ senderId: "someone-else", chatId: "other" }));
  assert.equal(reply.text, "reply-from-default");
  assert.equal(overrideCalls.length, 0);
  assert.deepEqual(defaultCalls[0].tools, ["exec", "files", "web_fetch"]);
  runtime.close();
});

test("channel-scoped routes only apply on their channel", async () => {
  const defaultCalls = [];
  const overrideCalls = [];
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({
    config: configWith([{ match: "tester", channel: "telegram", model: "tg-model" }]),
    store,
    provider: makeProvider("default", defaultCalls),
    providerForModel: (model) => makeProvider(`override:${model}`, overrideCalls),
  });
  const reply = await runtime.handleMessage(MSG());
  assert.equal(reply.text, "reply-from-default");
  assert.equal(overrideCalls.length, 0);
  runtime.close();
});

test("resolveSenderRoute matches sender or chat ids with channel scoping", () => {
  const { config, errors } = validateConfig({
    senders: [
      { match: "42", allowTools: ["files"] },
      { match: "77", channel: "telegram", model: "m2" },
    ],
  });
  assert.equal(errors.length, 0);
  assert.equal(resolveSenderRoute(config, { channel: "api", senderId: "42", chatId: "42" })?.allowTools?.[0], "files");
  // 77's route is telegram-scoped, so an api message does not match it.
  assert.equal(resolveSenderRoute(config, { channel: "api", senderId: "77", chatId: "77" }), null);
  assert.equal(resolveSenderRoute(config, { channel: "telegram", senderId: "77", chatId: "77" })?.model, "m2");
});