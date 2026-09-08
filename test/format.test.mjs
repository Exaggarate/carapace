// M11 formatting: markdown → Telegram HTML conversion, 4096 paragraph-boundary
// chunking (no mid-word splits, fences never broken), parse_mode=HTML payloads
// with a plain-text retry when Telegram rejects the entities. Mocked Bot API.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import { markdownToTelegramHtml, splitTelegramText, validateTelegramMarkdown } from "../dist/gateway/format.js";
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
      body = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      body = {};
    }
    calls.push({ method, body });
    const key = `${method}:${body.text ?? ""}`;
    if (key in overrides) return overrides[key](calls.length);
    if (method === "getMe") return jsonOk({ id: 1, username: "carapace_bot" });
    if (method === "getUpdates") return jsonOk([]);
    return jsonOk({ message_id: 1 });
  };
  return { calls, impl };
}

// ── markdownToTelegramHtml ──────────────────────────────────────────────────

test("html conversion: plain text survives verbatim", () => {
  const text = "plain reply, nothing special.\nsecond line";
  assert.equal(markdownToTelegramHtml(text), text);
});

test("html conversion: escapes HTML-significant characters", () => {
  assert.equal(
    markdownToTelegramHtml("a < b & c > d \"quoted\""),
    "a &lt; b &amp; c &gt; d &quot;quoted&quot;",
  );
});

test("html conversion: bold, italic, code, strike, underline", () => {
  assert.equal(markdownToTelegramHtml("**bold** and *soft*"), "<b>bold</b> and <i>soft</i>");
  assert.equal(markdownToTelegramHtml("use `npm run build` now"), "use <code>npm run build</code> now");
  assert.equal(markdownToTelegramHtml("~~gone~~ __deep__"), "<s>gone</s> <u>deep</u>");
  assert.equal(markdownToTelegramHtml("snake_case stays _italic_ alone"), "snake_case stays <i>italic</i> alone");
});

test("html conversion: fenced code blocks become pre, links become anchors", () => {
  assert.equal(
    markdownToTelegramHtml("```js\nconst a = 1 < 2;\n```"),
    '<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>',
  );
  assert.equal(
    markdownToTelegramHtml("[Carapace](https://example.com/a_b)"),
    '<a href="https://example.com/a_b">Carapace</a>',
  );
});

// ── splitTelegramText ───────────────────────────────────────────────────────

test("split: short text is one chunk", () => {
  assert.deepEqual(splitTelegramText("hello"), ["hello"]);
});

test("split: prefers paragraph boundaries, every chunk within 4096", () => {
  const para = "A".repeat(1500);
  const text = [para, para, para].join("\n\n");
  const chunks = splitTelegramText(text);
  assert.equal(chunks.length, 2, `chunks: ${chunks.map((c) => c.length).join(", ")}`);
  for (const chunk of chunks) assert.ok(chunk.length <= 4096, `chunk too long: ${chunk.length}`);
  // The cut lands on the paragraph boundary: chunk one is exactly two whole
  // paragraphs, chunk two the remaining one.
  assert.deepEqual(chunks, [[para, para].join("\n\n"), para]);
});

test("split: never splits mid-word when spaces exist", () => {
  const text = ("word ".repeat(1500) + "word");
  const chunks = splitTelegramText(text);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 4096, `chunk too long: ${chunk.length}`);
    for (const token of chunk.trim().split(" ")) {
      assert.equal(token, "word", `chunk boundary cut inside a word: "${chunk.slice(0, 30)}…"`);
    }
  }
});

test("split: a fenced block is never cut in half", () => {
  const intro = ("intro words ".repeat(170)).trimEnd(); // ≈ 2000 chars before the fence
  const outro = ("outro words ".repeat(170)).trimEnd();
  const fence = `\`\`\`\n${"x".repeat(3000)}\n\`\`\``;
  const text = `${intro}\n\n${fence}\n\n${outro}`;
  const chunks = splitTelegramText(text);
  assert.ok(chunks.length >= 2, `chunks: ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 4096, `chunk too long: ${chunk.length}`);
    const markers = (chunk.match(/```/g) ?? []).length;
    assert.equal(markers % 2, 0, `chunk has unbalanced fences: "${chunk.slice(0, 30)}…"`);
  }
});

test("split: a single oversized fence is closed and reopened across chunks", () => {
  const fence = `\`\`\`py\n${"y".repeat(9000)}\n\`\`\``;
  const chunks = splitTelegramText(fence);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 4096, `chunk too long: ${chunk.length}`);
    const markers = (chunk.match(/```/g) ?? []).length;
    assert.equal(markers % 2, 0, "every chunk must carry balanced fence markers");
  }
  assert.ok(chunks[0].startsWith("```py\n"), "first chunk opens the fence");
  assert.ok(chunks[0].endsWith("```"), "first chunk closes it at the cut");
  for (let index = 1; index < chunks.length - 1; index++) {
    assert.ok(chunks[index].startsWith("```py\n"), `chunk ${index} reopens the fence`);
    assert.ok(chunks[index].endsWith("```"), `chunk ${index} closes it`);
  }
});

// ── validateTelegramMarkdown (doctor seam) ──────────────────────────────────

test("validate: balanced markdown passes, unclosed fence fails", () => {
  assert.deepEqual(validateTelegramMarkdown("**hi**\n```\ncode\n```"), { ok: true, reason: null });
  assert.equal(validateTelegramMarkdown("```\nnever closed").ok, false);
  assert.equal(validateTelegramMarkdown("   ").ok, false);
});

// ── Telegram send payloads ──────────────────────────────────────────────────

test("send: replies go out with parse_mode HTML and converted entities", async () => {
  const { calls, impl } = captureFetch();
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  await channel.send("123", "Hello **world** — run `npm test`");
  const sent = calls.find((call) => call.method === "sendMessage");
  assert.ok(sent, "sendMessage was called");
  assert.equal(sent.body.parse_mode, "HTML");
  assert.ok(sent.body.text.includes("<b>world</b>"), `text was: ${sent.body.text}`);
  assert.ok(sent.body.text.includes("<code>npm test</code>"));
  assert.equal(sent.body.link_preview_options.is_disabled, true);
});

test("send: a 400 entity-parse rejection is retried verbatim without parse_mode", async () => {
  const { calls, impl } = captureFetch({
    "sendMessage:<b>bold</b> text": () => jsonError("Bad Request: can't parse entities"),
  });
  const channel = new TelegramChannel(tgConfig(), { fetchImpl: impl });
  await channel.send("123", "**bold** text");
  const sendMessageCalls = calls.filter((call) => call.method === "sendMessage");
  assert.equal(sendMessageCalls.length, 2, "retry happened exactly once");
  assert.equal(sendMessageCalls[0].body.parse_mode, "HTML");
  assert.equal(sendMessageCalls[1].body.parse_mode, undefined);
  assert.equal(sendMessageCalls[1].body.text, "**bold** text");
});