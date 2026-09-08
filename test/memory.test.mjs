// Memory tests (M9): the MemoryStore (plain files in a temp dir), the
// memory_read/memory_write tools through the real registry, and the system-prompt
// injection in the agent loop (mock provider — no network).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MemoryStore,
  MEMORY_DAILY_TAIL_LINES,
  MEMORY_DIGEST_LINES,
  todayIsoDate,
} from "../dist/core/memory.js";
import { createBuiltinToolRegistry } from "../dist/core/tools/builtins/index.js";
import { runAgentTurn } from "../dist/core/agent.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), "carapace-mem-"));
}

function line(index, width = 4) {
  return String(index).padStart(width, "0");
}

// ── MemoryStore ──────────────────────────────────────────────────────────────

test("daily notes are created with a date header and append-only", () => {
  const workspace = tempWorkspace();
  const memory = new MemoryStore(workspace);
  const path = memory.appendDaily("note A\n");
  assert.equal(path, memory.dailyPath(todayIsoDate()));
  const first = memory.readDaily(todayIsoDate());
  assert.match(first, new RegExp(`^# ${todayIsoDate()}\\n`));
  assert.match(first, /note A\n$/);

  memory.appendDaily("note B");
  const second = memory.readDaily(todayIsoDate());
  assert.match(second, /note A\n/);
  assert.match(second, /note B\n$/);
});

test("long-term memory file is created on first append", () => {
  const memory = new MemoryStore(tempWorkspace());
  assert.equal(memory.readLongTerm(), null);
  memory.appendLongTerm("the user prefers dark mode\n");
  const content = memory.readLongTerm();
  assert.match(content, /^# Long-term memory\n/);
  assert.match(content, /the user prefers dark mode\n$/);
});

test("contextBlock injects the daily tail and the long-term head", () => {
  const workspace = tempWorkspace();
  const memory = new MemoryStore(workspace);
  const today = todayIsoDate();
  mkdirSync(memory.memoryDir, { recursive: true });
  const dailyLines = Array.from({ length: 70 }, (_, index) => `D${line(index + 1)}`);
  writeFileSync(memory.dailyPath(today), `${dailyLines.join("\n")}\n`, "utf8");
  const longLines = Array.from({ length: 200 }, (_, index) => `M${line(index + 1, 3)}`);
  writeFileSync(memory.longTermPath(), `${longLines.join("\n")}\n`, "utf8");

  const block = memory.contextBlock();
  assert.match(block, /## Persistent memory/);
  assert.match(block, new RegExp(`Today: ${today}`));
  // Daily section: exactly the last MEMORY_DAILY_TAIL_LINES lines (D11..D70).
  assert.match(block, new RegExp(`last ${MEMORY_DAILY_TAIL_LINES} lines`));
  assert.match(block, new RegExp(`D${line(70)}$`, "m"));
  assert.match(block, /\nD0011\n/);
  assert.doesNotMatch(block, /D0010\n/);
  // Long-term section: exactly the first MEMORY_DIGEST_LINES lines (M001..M150).
  assert.match(block, new RegExp(`first ${MEMORY_DIGEST_LINES} lines`));
  assert.match(block, /M150$/m);
  assert.doesNotMatch(block, /M151/);
});

test("contextBlock is null when nothing is stored yet", () => {
  assert.equal(new MemoryStore(tempWorkspace()).contextBlock(), null);
});

test("memory survives 'restarts' — same files, new store instance", () => {
  const workspace = tempWorkspace();
  new MemoryStore(workspace).appendDaily("fact one\n");
  const fresh = new MemoryStore(workspace);
  assert.match(fresh.readDaily(todayIsoDate()), /fact one/);
  assert.equal(fresh.listDailyNotes().length, 1);
});

// ── memory tools ─────────────────────────────────────────────────────────────

function toolContext(workspace) {
  return { sessionId: "test:s1", workdir: tmpdir(), memoryWorkspace: workspace };
}

function memoryTools() {
  const registry = createBuiltinToolRegistry({
    tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
  });
  return { read: registry.get("memory_read"), write: registry.get("memory_write") };
}

test("memory_write + memory_read round-trip daily and long-term", async () => {
  const workspace = tempWorkspace();
  const { read, write } = memoryTools();

  const dailyWrite = await write.execute({ text: "remember the milk" }, { sessionId: "t", workdir: tmpdir(), memoryWorkspace: workspace });
  assert.equal(dailyWrite.ok, true);
  assert.match(dailyWrite.output, /appended to memory\//);

  const dailyRead = await read.execute({}, { sessionId: "s", workdir: tmpdir(), memoryWorkspace: workspace });
  assert.equal(dailyRead.ok, true);
  assert.match(dailyRead.output, /remember the milk/);

  const longWrite = await write.execute({ text: "prefers concise replies", target: "longterm" }, { sessionId: "s", workdir: tmpdir(), memoryWorkspace: workspace });
  assert.equal(longWrite.ok, true);
  const longRead = await read.execute({ file: "MEMORY.md" }, { sessionId: "s", workdir: tmpdir(), memoryWorkspace: workspace });
  assert.equal(longRead.ok, true);
  assert.match(longRead.output, /prefers concise replies/);
});

test("memory tools reject traversal, bad targets, bad dates, and empty text", async () => {
  const workspace = tempWorkspace();
  const { read, write } = memoryTools();
  const context = { sessionId: "s", workdir: tmpdir(), memoryWorkspace: workspace };

  const traversal = await read.execute({ file: "../../etc/passwd" }, context);
  assert.equal(traversal.ok, false);
  assert.match(traversal.output, /unknown memory file/);

  const badTarget = await write.execute({ text: "x", target: "database" }, context);
  assert.equal(badTarget.ok, false);
  assert.match(badTarget.output, /unknown target/);

  const badDate = await write.execute({ text: "x", date: "tomorrow" }, context);
  assert.equal(badDate.ok, false);
  assert.match(badDate.output, /invalid date/);

  const empty = await write.execute({ text: "   " }, context);
  assert.equal(empty.ok, false);
  assert.match(empty.output, /non-empty/);
});

test("reading a missing memory file reports absence instead of failing", async () => {
  const workspace = tempWorkspace();
  const { read } = memoryTools();
  const context = { sessionId: "s", workdir: tmpdir(), memoryWorkspace: workspace };
  const missingToday = await read.execute({}, context);
  assert.equal(missingToday.ok, true);
  assert.match(missingToday.output, /no memory file yet: memory\//);
  const missingDated = await read.execute({ file: "2026-01-02.md" }, context);
  assert.equal(missingDated.ok, true);
  assert.match(missingDated.output, /no memory file yet/);
});

test("memory tools are inert without a memory workspace in context", async () => {
  const { read, write } = memoryTools();
  const disabled = await read.execute({}, { sessionId: "s", workdir: tmpdir() });
  assert.equal(disabled.ok, false);
  assert.match(disabled.output, /memory system is not enabled/);
  const writeDisabled = await write.execute({ text: "x" }, { sessionId: "s", workdir: tmpdir() });
  assert.equal(writeDisabled.ok, false);
});

// ── agent injection ──────────────────────────────────────────────────────────

function makeAgentRuntime(memory, calls) {
  const store = new CarapaceStore(":memory:");
  const provider = {
    name: "fake",
    complete: async (request) => {
      calls.push(request.messages);
      return { text: "ok", toolCalls: [], stopReason: "final_answer" };
    },
  };
  return {
    config: {
      agent: { systemPrompt: "base prompt", maxToolIterations: 3 },
      tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    },
    provider,
    tools: new ToolRegistry(),
    sessions: new SessionStore(store),
    memory,
  };
}

test("agent turns inject the memory block into the system prompt", async () => {
  const workspace = tempWorkspace();
  const memory = new MemoryStore(workspace);
  memory.appendLongTerm("the owner's bot is called Shellby\n");

  const calls = [];
  await runAgentTurn({ sessionId: "test:m1", text: "hi" }, makeAgentRuntime(memory, calls));
  const systemMessage = calls[0].find((message) => message.role === "system");
  assert.match(systemMessage.content, /^base prompt/);
  assert.match(systemMessage.content, /## Persistent memory/);
  assert.match(systemMessage.content, /the owner's bot is called Shellby/);
});

test("a runtime without memory keeps the plain system prompt", async () => {
  const calls = [];
  await runAgentTurn({ sessionId: "test:m2", text: "hi" }, makeAgentRuntime(undefined, calls));
  const systemMessage = calls[0].find((message) => message.role === "system");
  assert.equal(systemMessage.content, "base prompt");
});