// Discord channel adapter tests (M6): hello/ready/dispatch/resume/reconnect flows over a
// fake WebSocket + fake REST fetch — zero real network. Covers identify, heartbeats,
// resume with session_id+seq, op7 reconnect, INVALID_SESSION hard restarts, 4004 fatal,
// zombie heartbeat detection, bot/webhook filtering, busy notices, rate limits, and the
// full runtime wiring (agent loop reply posted via REST, session per channel chat).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { DiscordChannel, splitDiscordContent, probeDiscordToken } from "../dist/gateway/channels/discord.js";
import { BusyTurnError } from "../dist/gateway/channels/types.js";
import { buildRuntime } from "../dist/gateway/runtime.js";
import { startGatewayServer } from "../dist/gateway/server.js";
import { validateConfig } from "../dist/config.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    FakeSocket.all.push(this);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type, event) {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(event);
  }
  send(data) {
    if (this.readyState !== 1) throw new Error("send on non-open socket");
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    setTimeout(() => {
      this.readyState = 3;
      this.emit("close", { type: "close", code, reason, wasClean: true });
    }, 0);
  }
  // Test-side drivers (simulating the Discord server).
  serverOpen() {
    this.readyState = 1;
    this.emit("open", { type: "open" });
  }
  serverFrame(packet) {
    this.emit("message", { type: "message", data: JSON.stringify(packet) });
  }
  serverClose(code = 1006) {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    setTimeout(() => this.emit("close", { type: "close", code, reason: "", wasClean: false }), 0);
  }
}
FakeSocket.all = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition, ms = 3000) {
  const started = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - started > ms) throw new Error("condition not met in time");
    await sleep(5);
  }
}

function lastSocket() {
  return FakeSocket.all[FakeSocket.all.length - 1];
}

function discordConfig(overrides = {}) {
  return {
    gateway: { host: "127.0.0.1", port: 0 },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: false, botToken: "unit-test-token", allowedSenders: [] },
      api: { enabled: false },
      discord: { enabled: true, botToken: "unit-test-token", ...overrides },
    },
    agent: { systemPrompt: "You are a test agent.", maxToolIterations: 12, announceTarget: null },
    senders: [],
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    storage: { path: ":memory:" },
  };
}

function makeRest({ failFirst = 0, retryAfterSec = 0.01, remainingHeader = "4" } = {}) {
  const posts = [];
  let calls = 0;
  const fetchImpl = async (input, init) => {
    const url = String(input);
    if (!url.includes("/channels/")) throw new Error(`unexpected REST url: ${url}`);
    posts.push({ url, body: JSON.parse(init?.body ?? "{}") });
    calls += 1;
    if (calls <= failFirst) {
      return {
        status: 429,
        ok: false,
        statusText: "Too Many Requests",
        headers: { get: () => null },
        json: async () => ({ retry_after: retryAfterSec, message: "You are being rate limited." }),
      };
    }
    return {
      status: 200,
      ok: true,
      statusText: "OK",
      headers: { get: (name) => (name === "x-ratelimit-remaining" ? remainingHeader : null) },
      json: async () => ({ id: "m1" }),
    };
  };
  return { posts, fetchImpl };
}

function helloPacket(interval = 30) {
  return { op: 10, d: { heartbeat_interval: interval, _trace: [] } };
}

function readyPacket(sessionId = "sess-1") {
  return {
    t: "READY",
    s: 2,
    op: 0,
    d: { session_id: sessionId, user: { id: "bot1", username: "carapace-bot" } },
  };
}

function messageCreate(text, overrides = {}) {
  return {
    t: "MESSAGE_CREATE",
    s: 7,
    op: 0,
    d: {
      id: "m1",
      channel_id: "ch1",
      content: text,
      author: { id: "u1", username: "alice", bot: false },
      ...overrides,
    },
  };
}

/** Start a channel against the fake sockets; drive hello → identify → READY. */
async function startChannel({ config, rest, interval } = {}) {
  const channel = new DiscordChannel(config ?? discordConfig(), {
    fetchImpl: rest?.fetchImpl,
    webSocketFactory: (url) => new FakeSocket(url),
    gatewayUrl: "wss://mock.gateway",
    restBase: "https://mock.rest/api",
  });
  const started = channel.start();
  await until(() => FakeSocket.all.length > 0);
  const socket = lastSocket();
  socket.serverOpen();
  socket.serverFrame(helloPacket(interval));
  await until(() => socket.sent.some((p) => p.op === 2));
  socket.serverFrame(readyPacket());
  await started;
  return { channel, socket };
}

test("config schema accepts channels.discord and defaults to disabled + CARAPACE_DISCORD_TOKEN", () => {
  const defaults = validateConfig({}).config;
  assert.equal(defaults.channels.discord.enabled, false);
  assert.deepEqual(defaults.channels.discord.botToken, { env: "CARAPACE_DISCORD_TOKEN" });

  const parsed = validateConfig({
    channels: { discord: { enabled: true, botToken: { file: "~/discord-token.txt" } } },
  }).config;
  assert.equal(parsed.channels.discord.enabled, true);
  assert.deepEqual(parsed.channels.discord.botToken, { file: "~/discord-token.txt" });

  const bad = validateConfig({ channels: { discord: { enabled: "yes" } } });
  assert.ok(bad.errors.some((e) => e.includes("channels.discord.enabled")));
});

test("probeDiscordToken reports ok / rejected-token / unreachable without leaking the token", async () => {
  const ok = await probeDiscordToken("tok", "https://mock.rest/api", async (url, init) => {
    assert.equal(url, "https://mock.rest/api/users/@me");
    assert.equal(init?.headers?.authorization, "Bot tok");
    return {
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => ({ username: "carapace-bot" }),
    };
  });
  assert.deepEqual(ok, { ok: true, fatal: false, detail: "gateway reachable; authenticated as carapace-bot" });

  const rejected = await probeDiscordToken("tok", "https://mock.rest/api", async () => ({
    status: 401,
    statusText: "Unauthorized",
    headers: { get: () => null },
    json: async () => ({ message: "401: Unauthorized" }),
  }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.fatal, true);

  const unreachable = await probeDiscordToken("tok", "https://mock.rest/api", async () => {
    throw new Error("connect ECONNREFUSED");
  });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.fatal, false);
  assert.match(unreachable.detail, /unreachable/);
});

test("identifies after hello (token + intents) and start() resolves on READY", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest });
  try {
    const identify = socket.sent.find((p) => p.op === 2);
    assert.ok(identify, "identify frame sent");
    assert.equal(identify.d.token, "unit-test-token");
    assert.equal(identify.d.intents, (1 << 9) | (1 << 7) | (1 << 15));
    assert.ok(identify.d.properties.browser === "carapace");
    assert.match(channel.describe(), /state=connected/);
    assert.doesNotMatch(channel.describe(), /unit-test-token/);
  } finally {
    await channel.stop();
  }
});

test("heartbeats carry the latest sequence number and heartbeat acks keep the link alive", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest, interval: 30 });
  try {
    await until(() => socket.sent.filter((p) => p.op === 1).length >= 1);
    assert.deepEqual(socket.sent.find((p) => p.op === 1), { op: 1, d: 2 }); // seq from READY (s=2)
    // ACK each beat; heartbeating continues afterwards (no zombie teardown).
    socket.serverFrame({ op: 11, d: 2 });
    await until(() => socket.sent.filter((p) => p.op === 1).length >= 2);
    socket.serverFrame({ op: 11, d: 2 });
    await until(() => socket.sent.filter((p) => p.op === 1).length >= 3);
    assert.equal(FakeSocket.all.length, 1, "no reconnect while acks arrive");
  } finally {
    await channel.stop();
  }
});

test("resume after dropped connection: op 6 carries session_id + seq, RESUMED restores state", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest });
  try {
    socket.serverFrame(messageCreate("hi")); // bumps seq to 7
    socket.serverClose(1006);
    await until(() => FakeSocket.all.length === 2);
    const second = lastSocket();
    second.serverOpen();
    second.serverFrame(helloPacket());
    await until(() => second.sent.some((p) => p.op === 6));
    const resume = second.sent.find((p) => p.op === 6);
    assert.equal(resume.d.session_id, "sess-1");
    assert.equal(resume.d.seq, 7);
    assert.equal(resume.d.token, "unit-test-token");
    second.serverFrame({ t: "RESUMED", s: 8, op: 0, d: {} });
    await until(() => FakeSocket.all.length === 2);
    assert.match(channel.describe(), /state=connected/);
  } finally {
    await channel.stop();
  }
});

test("RECONNECT (op 7) triggers the same resume path", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel } = await startChannel({ rest });
  try {
    const socket = lastSocket();
    socket.serverFrame({ op: 7, d: null });
    await until(() => FakeSocket.all.length === 2);
    const second = lastSocket();
    second.serverOpen();
    second.serverFrame(helloPacket());
    await until(() => second.sent.some((p) => p.op === 6));
    assert.equal(second.sent.find((p) => p.op === 6).d.session_id, "sess-1");
  } finally {
    await channel.stop();
  }
});

test("INVALID_SESSION d=false hard-restarts with a fresh identify (1–5 s pause)", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel } = await startChannel({ rest });
  try {
    const socket = lastSocket();
    socket.serverFrame({ op: 9, d: false });
    await until(() => FakeSocket.all.length === 2, 5000);
    const second = lastSocket();
    second.serverOpen();
    second.serverFrame(helloPacket());
    await until(() => second.sent.some((p) => p.op === 2), 5000);
    const identify = second.sent.find((p) => p.op === 2);
    assert.ok(identify, "fresh identify, not resume");
    assert.equal(second.sent.find((p) => p.op === 6), undefined);
    second.serverFrame(readyPacket("sess-2"));
    // New session remembered for future resumes.
    second.serverClose(1006);
    await until(() => FakeSocket.all.length === 3, 5000);
    const third = lastSocket();
    third.serverOpen();
    third.serverFrame(helloPacket());
    await until(() => third.sent.some((p) => p.op === 6));
    assert.equal(third.sent.find((p) => p.op === 6).d.session_id, "sess-2");
  } finally {
    await channel.stop();
  }
});

test("INVALID_SESSION d=true keeps the session and resumes", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel } = await startChannel({ rest });
  try {
    const socket = lastSocket();
    socket.serverFrame({ op: 9, d: true });
    await until(() => FakeSocket.all.length === 2, 5000);
    const second = lastSocket();
    second.serverOpen();
    second.serverFrame(helloPacket());
    await until(() => second.sent.some((p) => p.op === 6), 5000);
    assert.equal(second.sent.find((p) => p.op === 6).d.session_id, "sess-1");
  } finally {
    await channel.stop();
  }
});

test("close 4004 is fatal: no reconnect, state reports the rejected token", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel } = await startChannel({ rest });
  try {
    lastSocket().serverClose(4004);
    await sleep(400); // backoff window would have spawned a reconnect
    assert.equal(FakeSocket.all.length, 1);
    assert.match(channel.describe(), /fatal/);
  } finally {
    await channel.stop();
  }
});

test("a missed heartbeat ack tears the zombie link down and resumes", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel } = await startChannel({ rest, interval: 30 });
  try {
    // Never ack → the second heartbeat tick closes the socket (4000) → resume.
    await until(() => FakeSocket.all.length === 2);
    const closedWith = FakeSocket.all[0].readyState === 3;
    assert.ok(closedWith, "first socket closed");
    const second = lastSocket();
    second.serverOpen();
    second.serverFrame(helloPacket());
    await until(() => second.sent.some((p) => p.op === 6));
    assert.equal(second.sent.find((p) => p.op === 6).d.session_id, "sess-1");
  } finally {
    await channel.stop();
  }
});

test("MESSAGE_CREATE reaches the agent loop and the reply is posted via REST; bots/webhooks are ignored", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest });
  const seen = [];
  channel.onMessage(async (message) => {
    seen.push(message);
    return { text: "discord reply" };
  });
  try {
    socket.serverFrame(messageCreate("hello discord"));
    await until(() => rest.posts.length === 1);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], {
      channel: "discord",
      senderId: "u1",
      chatId: "ch1",
      text: "hello discord",
      receivedAt: seen[0].receivedAt,
    });
    assert.equal(rest.posts[0].url, "https://mock.rest/api/channels/ch1/messages");
    assert.equal(rest.posts[0].body.content, "discord reply");

    // Bot authors (including our own messages) and webhook chatter never reach the agent.
    socket.serverFrame(messageCreate("bot echo", { author: { id: "bot1", bot: true } }));
    socket.serverFrame(messageCreate("webhook", { webhook_id: "wh1" }));
    socket.serverFrame(messageCreate("", { content: "   " }));
    socket.serverFrame({ t: "TYPING_START", s: 9, op: 0, d: {} });
    await sleep(100);
    assert.equal(seen.length, 1);
    assert.equal(rest.posts.length, 1);
  } finally {
    await channel.stop();
  }
});

test("BusyTurnError from the handler becomes an in-chat notice", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest });
  channel.onMessage(async () => {
    throw new BusyTurnError("discord:ch1", 10);
  });
  try {
    socket.serverFrame(messageCreate("again"));
    await until(() => rest.posts.length === 1);
    assert.match(rest.posts[0].body.content, /still working on an earlier message/);
  } finally {
    await channel.stop();
  }
});

test("REST 429 retries once after retry_after; remaining=0 sets a cooldown before the next send", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest({ failFirst: 1, retryAfterSec: 0.02, remainingHeader: "0" });
  const { channel, socket } = await startChannel({ rest });
  channel.onMessage(async () => ({ text: "limited" }));
  try {
    socket.serverFrame(messageCreate("go"));
    await until(() => rest.posts.length === 2);
    assert.equal(rest.posts[0].body.content, "limited");
    assert.equal(rest.posts[1].body.content, "limited");

    // With x-ratelimit-remaining: 0 the queue waits (reset_after defaults to 1 s) —
    // a queued second message must not be POSTed immediately.
    const before = rest.posts.length;
    socket.serverFrame(messageCreate("second"));
    await sleep(50);
    assert.equal(rest.posts.length, before, "cooldown defers the next send");
  } finally {
    await channel.stop();
  }
});

test("long replies split at 2000 chars and post as multiple messages", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const { channel, socket } = await startChannel({ rest });
  channel.onMessage(async () => ({ text: "x".repeat(4500) }));
  try {
    socket.serverFrame(messageCreate("big"));
    await until(() => rest.posts.length >= 3);
    assert.equal(rest.posts.length, 3);
    for (const post of rest.posts) assert.ok(post.body.content.length <= 2000);
  } finally {
    await channel.stop();
  }
});

test("splitDiscordContent splits on whitespace when possible", () => {
  assert.deepEqual(splitDiscordContent("short"), ["short"]);
  const long = "a".repeat(1500) + "\n" + "b".repeat(1500);
  const chunks = splitDiscordContent(long);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], "a".repeat(1500));
  assert.equal(chunks[1], "b".repeat(1500));
  const wall = "x".repeat(5000);
  assert.deepEqual(
    splitDiscordContent(wall).map((c) => c.length),
    [2000, 2000, 1000],
  );
});

test("stop() prevents reconnects; stop() during start() rejects the start gate", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const channel = new DiscordChannel(discordConfig(), {
    fetchImpl: rest.fetchImpl,
    webSocketFactory: (url) => new FakeSocket(url),
    gatewayUrl: "wss://mock.gateway",
    restBase: "https://mock.rest/api",
  });
  const started = channel.start();
  await until(() => FakeSocket.all.length > 0);
  await assert.rejects(() => Promise.all([channel.stop(), started]), /stopped before the gateway became ready/);
  assert.equal(FakeSocket.all.length, 1);
  await sleep(300); // backoff window
  assert.equal(FakeSocket.all.length, 1, "no reconnect after stop");
  // A stopped channel refuses to re-send until started again.
  await assert.rejects(() => channel.send("ch1", "nope"), /not started/);
});

test("runtime wiring: discord adapter runs the agent loop end-to-end and keeps sessions per chat", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const store = new CarapaceStore(":memory:");
  const provider = {
    name: "fake",
    complete: async () => ({ text: "gateway says hi", toolCalls: [], stopReason: "final_answer" }),
  };
  const runtime = buildRuntime({
    config: discordConfig(),
    provider,
    store,
    discordOptions: {
      fetchImpl: rest.fetchImpl,
      webSocketFactory: (url) => new FakeSocket(url),
      gatewayUrl: "wss://mock.gateway",
      restBase: "https://mock.rest/api",
    },
  });
  const discord = runtime.channels.find((c) => c.name === "discord");
  assert.ok(discord, "discord adapter present in the runtime");
  try {
    const started = discord.start();
    await until(() => FakeSocket.all.length > 0);
    const socket = lastSocket();
    socket.serverOpen();
    socket.serverFrame(helloPacket());
    await until(() => socket.sent.some((p) => p.op === 2));
    socket.serverFrame(readyPacket());
    await started;

    socket.serverFrame(messageCreate("hello there"));
    await until(() => rest.posts.length === 1);
    assert.equal(rest.posts[0].body.content, "gateway says hi");
    assert.ok(store.getSession("discord:ch1"), "session keyed discord:<chatId>");
    assert.ok(store.listMessages("discord:ch1").length >= 2);
  } finally {
    await discord.stop().catch(() => undefined);
    runtime.close();
  }
});

test("runtime wiring: announceTarget routes the full reply to the discord chat (pushCapable)", async () => {
  FakeSocket.all.length = 0;
  const rest = makeRest();
  const config = discordConfig();
  config.gateway.apiToken = "unit-test-token";
  config.channels.api.enabled = true;
  config.agent.announceTarget = { channel: "discord", chatId: "ch-announce" };
  const store = new CarapaceStore(":memory:");
  const provider = {
    name: "fake",
    complete: async () => ({ text: "announce me", toolCalls: [], stopReason: "final_answer" }),
  };
  const runtime = buildRuntime({
    config,
    provider,
    store,
    discordOptions: {
      fetchImpl: rest.fetchImpl,
      webSocketFactory: (url) => new FakeSocket(url),
      gatewayUrl: "wss://mock.gateway",
      restBase: "https://mock.rest/api",
    },
  });
  const discord = runtime.channels.find((c) => c.name === "discord");
  const api = runtime.channels.find((c) => c.name === "api");
  try {
    const started = discord.start();
    await until(() => FakeSocket.all.length > 0);
    const socket = lastSocket();
    socket.serverOpen();
    socket.serverFrame(helloPacket());
    await until(() => socket.sent.some((p) => p.op === 2));
    socket.serverFrame(readyPacket());
    await started;

    const handle = await startGatewayServer({ host: "127.0.0.1", port: 0, routes: runtime.routes });
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer unit-test-token" },
      body: JSON.stringify({ senderId: "tester", text: "run this" }),
    });
    const body = await response.json();
    assert.match(body.reply, /routed to discord:ch-announce/);
    await until(() => rest.posts.length === 1);
    assert.equal(rest.posts[0].url, "https://mock.rest/api/channels/ch-announce/messages");
    assert.equal(rest.posts[0].body.content, "announce me");
    await handle.stop();
  } finally {
    await discord.stop().catch(() => undefined);
    await api.stop().catch(() => undefined);
    runtime.close();
  }
});