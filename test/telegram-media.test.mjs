// Telegram media handling: photo/document/voice parsing, filename sanitization,
// download into mediaDir, caption composition, oversized fallback, and the
// unsupported-type notice. All Bot API traffic goes through an injected fetchImpl —
// no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  mediaItemsFromMessage,
  sanitizeMediaFileName,
  TelegramChannel,
} from "../dist/gateway/channels/telegram.js";

function mediaConfig(mediaDir) {
  return {
    gateway: { host: "127.0.0.1", port: 0, apiToken: "unit-test-token" },
    llm: { baseURL: "http://localhost:9/v1", apiKey: "test", model: "fake", timeoutMs: 5_000 },
    channels: {
      telegram: { enabled: true, botToken: "unit-test-token", allowedSenders: [], mediaDir },
      api: { enabled: false },
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

/** Fake Bot API: getMe/getFile/sendMessage return JSON; /file/bot… returns raw bytes. */
function makeFetch({ fileBytes = "JPEGDATA" } = {}) {
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, body });
    if (url.includes("/getMe")) return jsonOk({ username: "media_bot" });
    if (url.includes("/getFile")) {
      return jsonOk({ file_id: "f1", file_unique_id: "u1", file_path: "photos/input.jpg", file_size: 8 });
    }
    if (url.includes("/file/bot")) {
      const bytes = new TextEncoder().encode(fileBytes);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => null },
        arrayBuffer: async () => bytes.buffer,
        text: async () => "",
        json: async () => ({}),
      };
    }
    if (url.includes("/sendMessage") || url.includes("/sendChatAction")) return jsonOk({ message_id: 9 });
    throw new Error(`unexpected url: ${url}`);
  };
  return { calls, fetchImpl };
}

function sentMessage(calls) {
  return calls.find((c) => c.url.includes("/sendMessage")) ?? null;
}

test("mediaItemsFromMessage parses photo (largest size), document, voice", () => {
  const items = mediaItemsFromMessage({
    photo: [
      { file_id: "small", file_unique_id: "s", file_size: 120 },
      { file_id: "big", file_unique_id: "b", file_size: 4096 },
    ],
    document: {
      file_id: "doc1",
      file_unique_id: "du1",
      file_name: "report.pdf",
      file_size: 2048,
      mime_type: "application/pdf",
    },
    voice: { file_id: "v1", file_unique_id: "vu1", file_size: 88_000, duration: 9 },
  });
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, "photo");
  assert.equal(items[0].fileId, "big");
  assert.equal(items[0].mimeType, "image/jpeg");
  assert.equal(items[1].kind, "document");
  assert.equal(items[1].fileName, "report.pdf");
  assert.equal(items[2].kind, "voice");
  assert.equal(items[2].durationSeconds, 9);
  assert.equal(mediaItemsFromMessage({ photo: [] }).length, 0);
});

test("sanitizeMediaFileName strips separators, control chars, and caps length", () => {
  assert.equal(sanitizeMediaFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeMediaFileName("a\x00b/c|d*"), "cd");
  assert.equal(sanitizeMediaFileName("a\x00b"), "ab");
  assert.equal(sanitizeMediaFileName(""), "file");
  assert.equal(sanitizeMediaFileName("x".repeat(100)).length, 64);
});

test("photo with caption downloads to mediaDir and reaches the agent as context", async () => {
  const mediaDir = join(mkdtempSync(join(tmpdir(), "carapace-media-")), "media");
  const { calls, fetchImpl } = makeFetch();
  const channel = new TelegramChannel(mediaConfig(mediaDir), { fetchImpl });
  const seen = [];
  channel.onMessage(async (m) => {
    seen.push(m);
    return { text: "nice photo" };
  });
  try {
    await channel.handleIncoming({
      message_id: 1,
      from: { id: 42, username: "tester" },
      chat: { id: 77 },
      caption: "what is this?",
      photo: [
        { file_id: "small", file_unique_id: "s", file_size: 1 },
        { file_id: "big", file_unique_id: "b", file_size: 4096 },
      ],
    });
    assert.equal(seen.length, 1);
    const expectedPath = join(mediaDir, "photo_b.jpg");
    assert.ok(seen[0].text.includes(expectedPath), `text should name ${expectedPath}`);
    assert.ok(seen[0].text.endsWith("what is this?"));
    assert.ok(existsSync(expectedPath));
    assert.equal(readFileSync(expectedPath, "utf8"), "JPEGDATA");
    const sent = sentMessage(calls);
    assert.ok(sent !== null && sent.body.includes("nice photo"));
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("voice and document attachments save under kind+uid names with details in context", async () => {
  const mediaDir = join(mkdtempSync(join(tmpdir(), "carapace-media-")), "media");
  const { calls, fetchImpl } = makeFetch({ fileBytes: "OGGDATA" });
  const channel = new TelegramChannel(mediaConfig(mediaDir), { fetchImpl });
  const seen = [];
  channel.onMessage(async (m) => {
    seen.push(m);
    return { text: "ok" };
  });
  try {
    await channel.handleIncoming({
      chat: { id: 77 },
      voice: { file_id: "v9", file_unique_id: "vu9", file_size: 100, duration: 21 },
    });
    assert.ok(seen[0].text.includes(join(mediaDir, "voice_vu9.ogg")));
    assert.ok(seen[0].text.includes("audio/ogg"));
    assert.ok(seen[0].text.includes("21s"));
    assert.ok(existsSync(join(mediaDir, "voice_vu9.ogg")));

    await channel.handleIncoming({
      chat: { id: 77 },
      document: { file_id: "d2", file_unique_id: "du2", file_name: "../../etc/passwd", file_size: 12 },
    });
    assert.ok(seen[1].text.includes(join(mediaDir, "doc_du2_passwd")));
    assert.ok(existsSync(join(mediaDir, "doc_du2_passwd")));
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("oversized attachments degrade to an unavailable note instead of failing the turn", async () => {
  const mediaDir = join(mkdtempSync(join(tmpdir(), "carapace-media-")), "media");
  const { fetchImpl } = makeFetch();
  const channel = new TelegramChannel(mediaConfig(mediaDir), { fetchImpl });
  const seen = [];
  channel.onMessage(async (m) => {
    seen.push(m);
    return { text: "ok" };
  });
  try {
    await channel.handleIncoming({
      chat: { id: 77 },
      photo: [{ file_id: "huge", file_unique_id: "h", file_size: 21 * 1024 * 1024 }],
    });
    assert.equal(seen.length, 1);
    assert.ok(seen[0].text.includes("[media] photo unavailable"));
    assert.ok(seen[0].text.includes("too large"));
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("messages with neither text nor supported media get the unsupported notice", async () => {
  const mediaDir = join(mkdtempSync(join(tmpdir(), "carapace-media-")), "media");
  const { calls, fetchImpl } = makeFetch();
  const channel = new TelegramChannel(mediaConfig(mediaDir), { fetchImpl });
  const seen = [];
  channel.onMessage(async (m) => {
    seen.push(m);
    return { text: "ok" };
  });
  try {
    await channel.handleIncoming({ chat: { id: 77 }, sticker: { file_id: "s1" } });
    assert.equal(seen.length, 0);
    const sent = sentMessage(calls);
    assert.ok(sent !== null && sent.body.includes("I can only process text, photos, documents and voice"));
  } finally {
    rmSync(mediaDir, { recursive: true, force: true });
  }
});