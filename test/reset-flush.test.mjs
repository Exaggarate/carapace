// Pre-reset memory flush (#45608): before a session's history is wiped, one LLM call
// distills key facts/decisions into the daily memory note. Failures only log — a
// reset is never blocked. Unit tests for the helper + the withResetFlush wrapper
// channels and the dashboard receive from buildRuntime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore, todayIsoDate } from "../dist/core/memory.js";
import { flushSessionToMemory, transcriptForFlush } from "../dist/core/flush.js";
import { withResetFlush } from "../dist/gateway/runtime.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";

const fakeProvider = (summary) => ({
  name: "fake",
  complete: async () => ({ text: summary, toolCalls: [], stopReason: "final_answer" }),
});

test("transcriptForFlush keeps user/assistant lines and drops tool chatter", () => {
  const transcript = transcriptForFlush([
    { role: "user", content: "remember my port is 8899" },
    { role: "assistant", content: "Noted — 8899.", toolCalls: [{ id: "t", name: "files", arguments: {} }] },
    { role: "tool", content: "file written", toolCallId: "t", toolName: "files" },
    { role: "assistant", content: "Done." },
  ]);
  assert.match(transcript, /User: remember my port is 8899/);
  assert.match(transcript, /Assistant: Noted — 8899\./);
  assert.match(transcript, /Assistant: Done\./);
  assert.ok(!transcript.includes("file written"));
});

test("transcriptForFlush elides older turns past the char cap", () => {
  const history = [];
  for (let index = 0; index < 50; index++) {
    history.push({ role: "user", content: `turn ${index} — ${"x".repeat(120)}` });
    history.push({ role: "assistant", content: `ack ${index}` });
  }
  const transcript = transcriptForFlush(history, 400);
  assert.match(transcript, /^\u2026\(older turns elided\)\u2026/);
  assert.ok(transcript.includes("turn 49"), "the newest turns survive truncation");
  assert.ok(!transcript.includes("turn 3 —"), "the oldest turns are elided");
});

test("flushSessionToMemory appends an agent summary to the daily note", async () => {
  const memory = new MemoryStore(mkdtempSync(join(tmpdir(), "carapace-flush-")));
  const outcome = await flushSessionToMemory({
    provider: fakeProvider("- fact one\n- decision two"),
    memory,
    sessionId: "api:c1",
    history: [
      { role: "user", content: "we chose SQLite over Postgres" },
      { role: "assistant", content: "Good call." },
    ],
  });
  assert.equal(outcome.flushed, true);
  const today = todayIsoDate();
  assert.equal(outcome.path, memory.dailyPath(today));
  const note = memory.readDaily(today) ?? "";
  assert.match(note, /## Reset — api:c1/);
  assert.match(note, /- fact one/);
  assert.match(note, /- decision two/);
});

test("flushSessionToMemory skips sessions with too little to save", async () => {
  const memory = new MemoryStore(mkdtempSync(join(tmpdir(), "carapace-flush-")));
  const outcome = await flushSessionToMemory({
    provider: fakeProvider("- should not happen"),
    memory,
    sessionId: "api:c2",
    history: [{ role: "user", content: "hi" }],
  });
  assert.equal(outcome.flushed, false);
  assert.equal(outcome.reason, "too few messages to summarize");
  assert.equal(memory.readDaily(todayIsoDate()), null);
});

test("flushSessionToMemory degrades on summarizer failure or empty output", async () => {
  const memory = new MemoryStore(mkdtempSync(join(tmpdir(), "carapace-flush-")));
  const history = [
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
  ];
  const failed = await flushSessionToMemory({
    provider: { name: "fake", complete: async () => { throw new Error("provider down"); } },
    memory,
    sessionId: "api:c3",
    history,
  });
  assert.equal(failed.flushed, false);
  assert.match(failed.reason, /summarizer failed: provider down/);

  const empty = await flushSessionToMemory({
    provider: fakeProvider("   "),
    memory,
    sessionId: "api:c4",
    history,
  });
  assert.equal(empty.flushed, false);
  assert.equal(empty.reason, "summarizer returned nothing");
});

test("withResetFlush: delete flushes the summary, then the session disappears", async () => {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  sessions.getOrCreate("s1", "api");
  sessions.appendUser("s1", "the launch code is blue");
  sessions.appendAssistant("s1", "Noted.");
  const memory = new MemoryStore(mkdtempSync(join(tmpdir(), "carapace-flush-")));
  const logs = [];
  const wrapped = withResetFlush({
    sessions,
    provider: fakeProvider("- launch code: blue"),
    memory,
    log: (line) => logs.push(line),
  });

  assert.equal(wrapped.delete("s1"), true);
  assert.equal(sessions.get("s1"), null, "the session is gone after the reset");
  // The flush is fire-and-forget: poll until the note lands (bounded).
  const noteDeadline = Date.now() + 2_000;
  let note = "";
  while (Date.now() < noteDeadline) {
    note = memory.readDaily(todayIsoDate()) ?? "";
    if (note.includes("## Reset — s1")) break;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.match(note, /## Reset — s1/);
  assert.match(note, /- launch code: blue/);
  assert.ok(logs.some((line) => line.includes("pre-reset flush")), "the flush is logged");

  // Deleting an unknown session stays a plain false with no flush.
  assert.equal(wrapped.delete("missing"), false);
});

test("withResetFlush: a failing summarizer never blocks the reset", async () => {
  const store = new CarapaceStore(":memory:");
  const sessions = new SessionStore(store);
  sessions.getOrCreate("s2", "api");
  sessions.appendUser("s2", "hello");
  sessions.appendAssistant("s2", "hi");
  const wrapped = withResetFlush({
    sessions,
    provider: { name: "fake", complete: async () => { throw new Error("down"); } },
    memory: new MemoryStore(mkdtempSync(join(tmpdir(), "carapace-flush-"))),
  });
  assert.equal(wrapped.delete("s2"), true);
  assert.equal(sessions.get("s2"), null);
});