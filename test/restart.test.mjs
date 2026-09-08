// Graceful restarts: persisted channel state (update offsets), contiguous frontier
// marking, and long-poll resume from the persisted offset. Mock Bot API — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildRuntime, channelStateAdapter } from "../dist/gateway/runtime.js";
import { TelegramChannel } from "../dist/gateway/channels/telegram.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function baseConfig() {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token", busyQueueLimit: 10 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: true, botToken: "unit-test-token", allowedSenders: [], mediaDir: tmpdir() },
      api: { enabled: true },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

function jsonOk(result) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    text: async () => JSON.stringify({ ok: true, result }),
    json: async () => ({ ok: true, result }),
  };
}

function telegramFetch() {
  const fetchImpl = async (input) => {
    const url = String(input);
    if (url.includes("/getMe")) return jsonOk({ username: "restart_bot" });
    if (url.includes("/sendMessage") || url.includes("/sendChatAction")) return jsonOk({ message_id: 9 });
    throw new Error(`unexpected url: ${url}`);
  };
  return { fetchImpl };
}

test("channel state persists across reopen (restart-safe offsets)", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "carapace-restart-")), "state.db");
  let store = new CarapaceStore(dbPath);
  store.setChannelState("telegram:update_offset", "5");
  assert.equal(store.getChannelState("telegram:update_offset"), "5");
  assert.equal(store.getChannelState("missing"), null);
  store.close();

  store = new CarapaceStore(dbPath);
  assert.equal(store.getChannelState("telegram:update_offset"), "5");
  store.close();
  rmSync(dbPath, { force: true });
});

test("telegram confirms only contiguous offsets; gaps wait for the missing id", async () => {
  const provider = {
    name: "fake",
    complete: async () => ({ text: "reply", toolCalls: [], stopReason: "final_answer" }),
  };
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({ config: baseConfig(), provider, store });
  const { fetchImpl } = telegramFetch();
  const channel = new TelegramChannel(baseConfig(), {
    fetchImpl,
    sessions: runtime.agent.sessions,
    offsetStore: channelStateAdapter(store),
  });
  try {
    await channel.processUpdate({ update_id: 5, message: { chat: { id: 77 }, from: { id: 42 }, text: "hi" } });
    assert.equal(store.getChannelState("telegram:update_offset"), "5");

    // id 7 alone leaves a gap at 6 — the frontier must not advance past it
    await channel.processUpdate({ update_id: 7, message: { chat: { id: 77 }, from: { id: 42 }, text: "again" } });
    assert.equal(store.getChannelState("telegram:update_offset"), "5");

    await channel.processUpdate({ update_id: 6, message: { chat: { id: 77 }, from: { id: 42 }, text: "fill" } });
    assert.equal(store.getChannelState("telegram:update_offset"), "7");
  } finally {
    store.close();
  }
});

test("a restarted gateway long-polls from the persisted offset", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "carapace-restart-")), "resume.db");
  const store = new CarapaceStore(dbPath);
  store.setChannelState("telegram:update_offset", "7");
  store.close();

  const reopened = new CarapaceStore(dbPath);
  const getUpdatesBodies = [];
  let releaseFirstPoll;
  const firstPoll = new Promise((resolve) => {
    releaseFirstPoll = resolve;
  });
  const fetchImpl = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    if (url.includes("/getMe")) return jsonOk({ username: "restart_bot" });
    if (url.includes("/getUpdates")) {
      getUpdatesBodies.push(body);
      if (getUpdatesBodies.length === 1 && releaseFirstPoll) releaseFirstPoll();
      return jsonOk([]);
    }
    if (url.includes("/sendMessage") || url.includes("/sendChatAction")) return jsonOk({ message_id: 1 });
    throw new Error(`unexpected url: ${url}`);
  };
  const channel = new TelegramChannel(baseConfig(), {
    fetchImpl,
    offsetStore: channelStateAdapter(reopened),
  });
  try {
    await channel.start();
    await firstPoll;
    await channel.stop();
    assert.ok(getUpdatesBodies.length >= 1, "at least one getUpdates call expected");
    assert.ok(getUpdatesBodies[0].includes('"offset":8'));
  } finally {
    reopened.close();
    rmSync(dbPath, { force: true });
  }
});