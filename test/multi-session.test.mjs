// Multi-session management: /sessions + /reset commands, session deletion with
// message cascade, and the auth-protected GET /api/v1/sessions endpoint.
// Mock provider and injected Bot API fetch — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { TelegramChannel } from "../dist/gateway/channels/telegram.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

function baseConfig(apiToken) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken },
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
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.includes("/getMe")) return jsonOk({ username: "sessions_bot" });
    if (url.includes("/sendMessage") || url.includes("/sendChatAction")) return jsonOk({ message_id: 9 });
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

function sentBody(calls, needle) {
  const call = [...calls].reverse().find((c) => c.url.includes("/sendMessage") && c.body.includes(needle));
  return call === null || call === undefined ? null : call.body;
}

test("sqlite deleteSession cascades messages and countMessages counts", () => {
  const store = new CarapaceStore(":memory:");
  store.createSession("s1", "test");
  store.appendMessage("s1", "user", "one");
  store.appendMessage("s1", "assistant", "two");
  assert.equal(store.countMessages("s1"), 2);
  assert.equal(store.deleteSession("s1"), true);
  assert.equal(store.getSession("s1"), null);
  assert.equal(store.listMessages("s1").length, 0);
  assert.equal(store.countMessages("s1"), 0);
  assert.equal(store.deleteSession("s1"), false);
  store.close();
});

test("/reset wipes the chat's session; /sessions lists recent sessions", async () => {
  const provider = {
    name: "fake",
    complete: async () => ({ text: "agent reply", toolCalls: [], stopReason: "final_answer" }),
  };
  const store = new CarapaceStore(":memory:");
  const runtime = buildRuntime({ config: baseConfig("unit-test-token"), provider, store });
  const { calls, fetchImpl } = telegramFetch();
  const channel = new TelegramChannel(baseConfig("unit-test-token"), {
    fetchImpl,
    sessions: runtime.agent.sessions,
  });
  channel.onMessage(runtime.handleMessage);
  try {
    await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "hello" });
    assert.equal(store.countMessages("telegram:77"), 2); // user + assistant

    await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "/reset" });
    assert.equal(store.getSession("telegram:77"), null);
    assert.ok(sentBody(calls, "Session reset") !== null);

    await channel.handleIncoming({ chat: { id: 88 }, from: { id: 42 }, text: "hi again" });
    await channel.handleIncoming({ chat: { id: 88 }, from: { id: 42 }, text: "/sessions" });
    const listing = sentBody(calls, "Sessions (10 most recent)");
    assert.ok(listing !== null && listing.includes("telegram:88"));
    assert.ok(listing.includes("2 msg"));
  } finally {
    store.close();
  }
});

test("GET /api/v1/sessions requires the bearer token and lists sessions", async () => {
  const provider = {
    name: "fake",
    complete: async () => ({ text: "hi", toolCalls: [], stopReason: "final_answer" }),
  };
  const runtime = buildRuntime({
    config: baseConfig("unit-test-token"),
    provider,
    store: new CarapaceStore(":memory:"),
  });
  const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
  try {
    const url = `http://127.0.0.1:${handle.port}/api/v1/sessions`;
    const unauth = await fetch(url);
    assert.equal(unauth.status, 401);

    const post = await fetch(`http://127.0.0.1:${handle.port}/api/v1/messages`, {
      method: "POST",
      headers: { authorization: "Bearer unit-test-token", "content-type": "application/json" },
      body: JSON.stringify({ senderId: "tester", text: "hello" }),
    });
    assert.equal(post.status, 200);

    const authed = await fetch(url, { headers: { authorization: "Bearer unit-test-token" } });
    assert.equal(authed.status, 200);
    const body = await authed.json();
    assert.ok(Array.isArray(body.sessions) && body.sessions.length >= 1);
    const apiSession = body.sessions.find((s) => s.id === "api:tester");
    assert.ok(apiSession !== undefined);
    assert.equal(apiSession.channel, "api");
    assert.equal(apiSession.messages, 2);
  } finally {
    await handle.stop();
    runtime.close();
  }
});