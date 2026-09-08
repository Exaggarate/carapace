// M11 command layer: shared slash commands (start message, help, status,
// sessions, skills, automations, unknown-command notice) across Telegram and
// Discord; config-driven startMessage. Mocked transports — no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { TelegramChannel } from "../dist/gateway/channels/telegram.js";
import {
  DEFAULT_HELP_TEXT,
  DEFAULT_START_MESSAGE,
  handleSlashCommand,
} from "../dist/gateway/commands.js";
import { VERSION } from "../dist/version.js";

function tgConfig(telegramOverrides = {}) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: {
      baseURL: "http://localhost:9/v1",
      apiKey: "test",
      model: "fake-model",
      provider: "openai",
      timeoutMs: 5_000,
      fallbacks: [
        { provider: "ollama", model: "llama3.1" },
        { provider: "openai", model: "backup-model", baseURL: "http://localhost:9/v1", apiKey: "k" },
      ],
    },
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

function sessionsMock() {
  return {
    list: (limit) => [
      {
        id: "telegram:88",
        channel: "telegram",
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 30_000,
        metadata: "{}",
      },
    ],
    countMessages: () => 2,
    delete: () => true,
  };
}

const skillsMock = {
  list: () => [
    { name: "deploy-check", description: "Pre-deploy verification steps", path: "/x", dir: "/x", source: "test", body: "" },
  ],
};

const automationsMock = {
  list: () => [
    {
      id: "j1",
      name: "morning-digest",
      kind: "every",
      spec: "10m",
      prompt: "digest",
      channel: "telegram",
      chatId: "42",
      enabled: true,
      lastRun: null,
      nextRun: Date.now() + 300_000,
      state: "idle",
      lastError: null,
      createdAt: Date.now(),
    },
  ],
};

function commandCtx(overrides = {}) {
  return {
    channel: "telegram",
    chatId: "77",
    senderId: "42",
    version: VERSION,
    startedAtMs: Date.now() - 90_000,
    config: tgConfig(),
    sessions: sessionsMock(),
    skills: skillsMock,
    automations: automationsMock,
    ...overrides,
  };
}

// ── handleSlashCommand ──────────────────────────────────────────────────────

test("non-command text returns null and flows to the agent", async () => {
  assert.equal(await handleSlashCommand("hello there", commandCtx()), null);
  assert.equal(await handleSlashCommand("", commandCtx()), null);
});

test("/start returns the branded default; a config override wins", async () => {
  const deflt = await handleSlashCommand("/start", commandCtx({ startMessage: undefined }));
  assert.ok(deflt.text.includes("Carapace"));
  assert.ok(deflt.text.includes("🦞"));
  assert.ok(deflt.text.includes("**What I can do**"));
  assert.ok(deflt.text.includes("/help"), "start message lists commands");
  assert.ok(deflt.text.includes("no fluff"), "start message carries the personality line");

  const custom = await handleSlashCommand("/start", commandCtx({ startMessage: "Custom hello **there**" }));
  assert.equal(custom.text, "Custom hello **there**");
});

test("/help is a grouped full command reference", async () => {
  const help = await handleSlashCommand("/help", commandCtx());
  assert.equal(help.text, DEFAULT_HELP_TEXT);
  for (const expected of ["/start", "/help", "/sessions", "/reset", "/status", "/skills", "/automations", "/id"]) {
    assert.ok(help.text.includes(expected), `help lists ${expected}`);
  }
  assert.ok(help.text.includes("**Chat & sessions**"), "grouped: chat & sessions");
  assert.ok(help.text.includes("**Capabilities**"), "grouped: capabilities");
});

test("/status shows version, uptime, provider+model, fallback count", async () => {
  const status = await handleSlashCommand("/status", commandCtx());
  assert.ok(status.text.includes(`v${VERSION}`));
  assert.ok(status.text.includes("uptime:"), status.text);
  assert.ok(status.text.includes("model: openai/fake-model"));
  assert.ok(status.text.includes("(+2 fallbacks)"));
  assert.ok(status.text.includes("channel: telegram · chat 77"));
});

test("/sessions keeps the established listing format", async () => {
  const listing = await handleSlashCommand("/sessions", commandCtx());
  assert.ok(listing.text.includes("📚 Sessions (10 most recent):"));
  assert.ok(listing.text.includes("telegram:88 · 2 msg ·"));
  const unavailable = await handleSlashCommand("/sessions", commandCtx({ sessions: null }));
  assert.ok(unavailable.text.includes("Session store unavailable"));
});

test("/skills lists playbooks; /automations lists scheduled jobs", async () => {
  const skills = await handleSlashCommand("/skills", commandCtx());
  assert.ok(skills.text.includes("🧩 Installed skills (1):"));
  assert.ok(skills.text.includes("**deploy-check** — Pre-deploy verification steps"));
  const none = await handleSlashCommand("/skills", commandCtx({ skills: { list: () => [] } }));
  assert.ok(none.text.includes("No skills installed"));

  const autos = await handleSlashCommand("/automations", commandCtx());
  assert.ok(autos.text.includes("⏰ Scheduled automations (1):"));
  assert.ok(autos.text.includes("**morning-digest** — every 10m → telegram:42"));
  const noAutos = await handleSlashCommand("/automations", commandCtx({ automations: { list: () => [] } }));
  assert.ok(noAutos.text.includes("No automations scheduled"));
});

test("unknown slash commands get a friendly notice, never the agent", async () => {
  const outcome = await handleSlashCommand("/definitelynotacommand", commandCtx());
  assert.ok(outcome.text.includes('Unknown command "/definitelynotacommand"'));
  assert.ok(outcome.text.includes("/help"));
});

test("/reset falls back to the shared session deletion", async () => {
  const outcome = await handleSlashCommand("/reset", commandCtx());
  assert.ok(outcome.text.includes("🧹 Session reset"));
});

test("/id falls back to the channel-neutral format; command matching strips @bot suffixes", async () => {
  const id = await handleSlashCommand("/id", commandCtx());
  assert.ok(id.text.includes("chat id: telegram:77"));
  const suffixed = await handleSlashCommand("/help@carapace_bot", commandCtx());
  assert.equal(suffixed.text, DEFAULT_HELP_TEXT);
});

// ── Telegram integration ────────────────────────────────────────────────────

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

function captureFetch() {
  const calls = [];
  const impl = async (input, init) => {
    const method = String(input).split("/bot")[1]?.split("/")[1] ?? "unknown";
    let body = {};
    try {
      body = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      body = {};
    }
    if (method === "sendMessage") calls.push(body);
    if (method === "getMe") return jsonOk({ id: 1, username: "carapace_bot" });
    if (method === "getUpdates") return jsonOk([]);
    return jsonOk({ message_id: 1 });
  };
  return { calls, impl };
}

test("telegram /start sends the branded welcome with HTML formatting", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42, username: "tester" }, text: "/start" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parse_mode, "HTML");
  assert.ok(calls[0].text.includes("<b>Carapace</b>"), `sent: ${calls[0].text}`);
  assert.ok(calls[0].text.includes("🦞"));
});

test("telegram /start uses channels.telegram.startMessage when configured", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig({ startMessage: "Custom hello **there**" }), { fetchImpl: impl });
  await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "/start" });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].text.includes("Custom hello <b>there</b>"));
});

test("telegram /status and unknown commands answer in-channel", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "/status" });
  assert.ok(calls[0].text.includes(`v${VERSION}`), `sent: ${calls[0].text}`);

  await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "/nope" });
  assert.ok(calls[1].text.includes("Unknown command"));
  assert.ok(calls[1].text.includes("&quot;/nope&quot;"), `sent: ${calls[1].text}`);
});

test("telegram /id keeps its raw format; /sessions delegates to the shared layer", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(
    tgConfig(),
    { fetchImpl: impl, sessions: sessionsMock(), commands: { startedAtMs: Date.now() } },
  );
  await channel.handleIncoming({ chat: { id: 77 }, from: { id: 42 }, text: "/id" });
  assert.ok(calls[0].text.includes("chat id: 77"));
  assert.ok(calls[0].text.includes("sender id: 42"));

  await channel.handleIncoming({ chat: { id: 88 }, from: { id: 42 }, text: "/sessions" });
  assert.ok(calls[1].text.includes("📚 Sessions (10 most recent):"));
  assert.ok(calls[1].text.includes("telegram:88 · 2 msg ·"));
});