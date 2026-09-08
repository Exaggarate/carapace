// Telegram Business support (#20786): business_connection registration (with
// restart-safe persistence), business_message routing through the agent loop
// with business context and separate sessions, replies carrying
// business_connection_id, the channels.telegram.business toggle, and
// allowedSenders not gating business customers. All Bot API traffic goes through
// an injected fetchImpl — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { TelegramChannel } from "../dist/gateway/channels/telegram.js";
import { buildRuntime } from "../dist/gateway/runtime.js";

function businessConfig(telegramOverrides = {}) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: {
        enabled: true,
        botToken: "unit-test-token",
        allowedSenders: [],
        mediaDir: tmpdir(),
        business: true,
        ...telegramOverrides,
      },
      api: { enabled: false },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12, announceTarget: null },
    senders: [],
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

const CONNECTION_ID = "conn_123";
const BIZ_CHAT = 9001;
const CUSTOMER = 7001;

function connectionUpdate(overrides = {}) {
  return {
    update_id: 41,
    business_connection: {
      id: CONNECTION_ID,
      user_chat_id: 555,
      date: 1700000000,
      can_reply: true,
      is_enabled: true,
      user: { id: 4242, username: "bizowner", first_name: "Biz", last_name: "Owner" },
      ...overrides,
    },
  };
}

function businessMessageUpdate(text = "order status?", overrides = {}) {
  return {
    update_id: 42,
    business_message: {
      message_id: 77,
      business_connection_id: CONNECTION_ID,
      from: { id: CUSTOMER, username: "customer1" },
      chat: { id: BIZ_CHAT, type: "private" },
      text,
      ...overrides,
    },
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

/** Fake Bot API: getMe answers, getUpdates returns the scripted batches in order, sends succeed. */
function makeFetch({ getUpdatesBatches = [] } = {}) {
  const calls = [];
  let pollCount = 0;
  const fetchImpl = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    if (url.includes("/getMe")) return jsonOk({ username: "biz_bot" });
    if (url.includes("/getUpdates")) {
      const batch = getUpdatesBatches[pollCount] ?? [];
      pollCount += 1;
      return jsonOk(batch);
    }
    if (url.includes("/sendMessage") || url.includes("/sendChatAction")) return jsonOk({ message_id: 9 });
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

function sentMessages(calls) {
  return calls.filter((c) => c.url.includes("/sendMessage")).map((c) => JSON.parse(c.body));
}

async function until(condition, ms = 2000) {
  const started = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - started > ms) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("business_connection registers; business_message reaches the agent with business context and replies carry business_connection_id", async () => {
  const { calls, fetchImpl } = makeFetch();
  const channel = new TelegramChannel(businessConfig(), { fetchImpl });
  const seen = [];
  channel.onMessage(async (message) => {
    seen.push(message);
    return { text: "business reply" };
  });

  await channel.processUpdate(connectionUpdate());
  assert.equal(seen.length, 0); // connection updates are bookkeeping, not agent turns

  await channel.processUpdate(businessMessageUpdate());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].channel, "telegram");
  assert.equal(seen[0].chatId, String(BIZ_CHAT));
  assert.equal(seen[0].senderId, String(CUSTOMER));
  assert.equal(seen[0].sessionKey, `telegram:business:${BIZ_CHAT}`);
  assert.ok(seen[0].text.startsWith("[business] Replying on behalf of @bizowner"), "context line present");
  assert.ok(seen[0].text.includes("order status?"), "customer text rides along");

  const reply = sentMessages(calls).find((b) => b.text === "business reply");
  assert.ok(reply, "reply was sent");
  assert.equal(reply.chat_id, String(BIZ_CHAT));
  assert.equal(reply.business_connection_id, CONNECTION_ID);

  const typing = calls.filter((c) => c.url.includes("/sendChatAction")).map((c) => JSON.parse(c.body));
  assert.ok(typing.some((b) => b.business_connection_id === CONNECTION_ID), "typing indicator scoped to connection");
});

test("business connection state survives a restart — a fresh adapter answers without a new business_connection update", async () => {
  const store = new Map();
  const offsetStore = {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => store.set(key, value),
  };
  const first = new TelegramChannel(businessConfig(), { fetchImpl: makeFetch().fetchImpl, offsetStore });
  first.onMessage(async () => ({ text: "ignored" }));
  await first.processUpdate(connectionUpdate());

  // Simulated restart: brand-new adapter sharing only the persisted channel state.
  const { calls, fetchImpl } = makeFetch();
  const second = new TelegramChannel(businessConfig(), { fetchImpl, offsetStore });
  const seen = [];
  second.onMessage(async (message) => {
    seen.push(message);
    return { text: "after restart" };
  });
  await second.processUpdate(businessMessageUpdate());
  assert.equal(seen.length, 1);
  const reply = sentMessages(calls).find((b) => b.text === "after restart");
  assert.ok(reply && reply.business_connection_id === CONNECTION_ID);
});

test("business_message with unknown, disabled, or non-replying connection is dropped", async () => {
  const cases = [
    { name: "unknown connection", connection: null },
    { name: "is_enabled=false", connection: connectionUpdate({ is_enabled: false }) },
    { name: "can_reply=false", connection: connectionUpdate({ can_reply: false }) },
  ];
  for (const testCase of cases) {
    const { calls, fetchImpl } = makeFetch();
    const channel = new TelegramChannel(businessConfig(), { fetchImpl });
    let handled = 0;
    channel.onMessage(async () => {
      handled += 1;
      return { text: "nope" };
    });
    if (testCase.connection !== null) await channel.processUpdate(testCase.connection);
    await channel.processUpdate(businessMessageUpdate());
    assert.equal(handled, 0, testCase.name);
    assert.equal(sentMessages(calls).length, 0, testCase.name);
  }
});

test("channels.telegram.business=false drops business messages but keeps direct chats and connection recording", async () => {
  const { calls, fetchImpl } = makeFetch();
  const channel = new TelegramChannel(businessConfig({ business: false }), { fetchImpl });
  const seen = [];
  channel.onMessage(async (message) => {
    seen.push(message);
    return { text: "ok" };
  });

  await channel.processUpdate(connectionUpdate()); // still recorded for a later re-enable
  await channel.processUpdate(businessMessageUpdate());
  assert.equal(seen.length, 0);

  // Direct chats are unaffected by the toggle.
  await channel.handleIncoming({ from: { id: 42, username: "owner" }, chat: { id: 42, type: "private" }, text: "hi" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sessionKey, undefined);
  const reply = sentMessages(calls).find((b) => b.text === "ok");
  assert.ok(reply && reply.business_connection_id === undefined);
});

test("allowedSenders gates direct chats only — business customers are authorized by the connection", async () => {
  const { calls, fetchImpl } = makeFetch();
  const channel = new TelegramChannel(businessConfig({ allowedSenders: ["111"] }), { fetchImpl });
  const seen = [];
  channel.onMessage(async (message) => {
    seen.push(message);
    return { text: "allowed" };
  });

  await channel.processUpdate(connectionUpdate());
  await channel.handleIncoming({ from: { id: CUSTOMER }, chat: { id: CUSTOMER, type: "private" }, text: "hi" });
  assert.equal(seen.length, 0); // direct chat from a non-allowed sender is ignored
  await channel.processUpdate(businessMessageUpdate());
  assert.equal(seen.length, 1); // business chat from the same customer is answered
});

test("getUpdates requests business update types and the poll loop processes business messages end-to-end", async () => {
  const { calls, fetchImpl } = makeFetch({ getUpdatesBatches: [[connectionUpdate(), businessMessageUpdate()]] });
  const channel = new TelegramChannel(businessConfig(), { fetchImpl });
  const seen = [];
  channel.onMessage(async (message) => {
    seen.push(message);
    return { text: "polled" };
  });
  await channel.start();
  await until(() => seen.length >= 1);
  await channel.stop();

  const poll = calls.find((c) => c.url.includes("/getUpdates"));
  assert.ok(poll, "getUpdates was called");
  const body = JSON.parse(poll.body);
  assert.deepEqual(body.allowed_updates, ["message", "business_message", "business_connection"]);
  const reply = sentMessages(calls).find((b) => b.text === "polled");
  assert.ok(reply && reply.business_connection_id === CONNECTION_ID);
});

test("runtime routes business messages to their own session namespace via sessionKey", async () => {
  const runtime = buildRuntime({
    config: businessConfig(),
    provider: {
      name: "fake",
      complete: async () => ({ text: "done", toolCalls: [], stopReason: "final_answer" }),
    },
  });
  try {
    const reply = await runtime.handleMessage({
      channel: "telegram",
      senderId: String(CUSTOMER),
      chatId: String(BIZ_CHAT),
      text: "hello",
      receivedAt: Date.now(),
      sessionKey: `telegram:business:${BIZ_CHAT}`,
    });
    assert.equal(reply.text, "done");
    assert.ok(
      runtime.agent.sessions.list(50).some((s) => s.id === `telegram:business:${BIZ_CHAT}`),
      "business session created under its own namespace",
    );

    // A plain message for the same numeric chat lands in the default session instead.
    await runtime.handleMessage({
      channel: "telegram",
      senderId: String(CUSTOMER),
      chatId: String(BIZ_CHAT),
      text: "again",
      receivedAt: Date.now(),
    });
    const ids = runtime.agent.sessions.list(50).map((s) => s.id);
    assert.ok(ids.includes(`telegram:${BIZ_CHAT}`));
    assert.equal(ids.filter((id) => id === `telegram:business:${BIZ_CHAT}`).length, 1);
  } finally {
    runtime.close();
  }
});