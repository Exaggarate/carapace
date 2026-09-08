// Ack/done reaction emojis (#8508): channels.telegram.ackEmoji is set as a reaction
// on received messages, doneEmoji when the turn for that message completed; empty
// strings disable; business chats never get reactions (Bot API limitation); a failed
// reaction never breaks message handling. Mocked Bot API transport — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { TelegramChannel } from "../dist/gateway/channels/telegram.js";

function tgConfig(telegramOverrides = {}) {
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
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12 },
    senders: [],
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

function jsonError(description) {
  return {
    ok: false,
    status: 400,
    statusText: "Bad Request",
    headers: { get: () => null },
    text: async () => JSON.stringify({ ok: false, description }),
    json: async () => ({ ok: false, description }),
  };
}

function captureFetch(overrides = {}) {
  const calls = [];
  const impl = async (input, init) => {
    const method = String(input).split("/bot")[1]?.split("/")[1] ?? "unknown";
    let body = {};
    try {
      body = JSON.parse(init?.body ?? "{}");
    } catch {}
    calls.push({ method, body });
    return overrides[method] ?? jsonOk({});
  };
  return { calls, impl };
}

const plainMessage = {
  message_id: 77,
  from: { id: 100, username: "tester" },
  chat: { id: 4242, type: "private" },
  text: "hello there",
  date: 1700000000,
};

test("defaults: 👀 on receipt, ✅ on completion, around the reply", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  channel.onMessage(async () => ({ text: "agent reply" }));

  await channel.handleIncoming(plainMessage);

  const reactions = calls.filter((call) => call.method === "setMessageReaction");
  assert.equal(reactions.length, 2, "one ack + one done reaction");
  assert.deepEqual(reactions[0].body.reaction, [{ type: "emoji", emoji: "👀" }]);
  assert.equal(reactions[0].body.message_id, 77);
  assert.equal(reactions[0].body.chat_id, "4242");
  assert.deepEqual(reactions[1].body.reaction, [{ type: "emoji", emoji: "✅" }]);
  assert.equal(reactions[1].body.message_id, 77);

  const sendIndex = calls.findIndex((call) => call.method === "sendMessage");
  const ackIndex = calls.findIndex((call) => call.method === "setMessageReaction");
  const doneIndex = calls.lastIndexOf ? calls.map((c) => c.method).lastIndexOf("setMessageReaction") : -1;
  assert.ok(ackIndex < sendIndex, "ack fires before the reply is sent");
  assert.ok(sendIndex < doneIndex, "done fires after the reply is sent");
  assert.equal(calls.find((call) => call.method === "sendMessage").body.text, "agent reply");
});

test("custom emojis and disable: ackEmoji override, doneEmoji '' disables", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig({ ackEmoji: "🫡", doneEmoji: "" }), { fetchImpl: impl });
  channel.onMessage(async () => ({ text: "agent reply" }));

  await channel.handleIncoming(plainMessage);

  const reactions = calls.filter((call) => call.method === "setMessageReaction");
  assert.equal(reactions.length, 1, "only the ack reaction is set");
  assert.deepEqual(reactions[0].body.reaction, [{ type: "emoji", emoji: "🫡" }]);
  assert.equal(calls.find((call) => call.method === "sendMessage").body.text, "agent reply");
});

test("business messages never receive reactions", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  channel.onMessage(async () => ({ text: "biz reply" }));

  const businessMessage = {
    message_id: 88,
    business_connection_id: "conn_123",
    from: { id: 200 },
    chat: { id: 9001, type: "private" },
    text: "order status?",
  };
  await channel.handleIncoming(businessMessage, { connectionId: "conn_123", label: "Biz Owner" });

  assert.equal(calls.filter((call) => call.method === "setMessageReaction").length, 0);
  const send = calls.find((call) => call.method === "sendMessage");
  assert.equal(send.body.business_connection_id, "conn_123");
});

test("a failed reaction never blocks the reply", async () => {
  const { calls, impl } = captureFetch({ setMessageReaction: jsonError("RECTION_INVALID") });
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  channel.onMessage(async () => ({ text: "still works" }));

  await channel.handleIncoming(plainMessage);

  const send = calls.find((call) => call.method === "sendMessage");
  assert.equal(send.body.text, "still works");
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
});

test("unauthorized senders are not acknowledged", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig({ allowedSenders: ["999"] }), { fetchImpl: impl });
  channel.onMessage(async () => ({ text: "should not happen" }));

  await channel.handleIncoming(plainMessage);

  assert.equal(calls.filter((call) => call.method === "setMessageReaction").length, 0);
  assert.equal(calls.filter((call) => call.method === "sendMessage").length, 0);
});