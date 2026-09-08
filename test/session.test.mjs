// Session-store tests: identity, history round-trip with tool calls, context assembly.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";

test("session store round-trips messages including tool calls", () => {
  const sessions = new SessionStore(new CarapaceStore(":memory:"));

  const created = sessions.getOrCreate("telegram:42", "telegram", { title: "unit test" });
  assert.equal(created.channel, "telegram");
  sessions.getOrCreate("telegram:42", "telegram");
  assert.equal(sessions.list().length, 1);

  sessions.appendUser("telegram:42", "hello");
  sessions.appendAssistant("telegram:42", "", [{ id: "c1", name: "echo", arguments: { text: "hi" } }]);
  sessions.appendToolResult("telegram:42", "c1", "echo", "hi");
  sessions.appendAssistant("telegram:42", "done");

  const history = sessions.history("telegram:42");
  assert.equal(history.length, 4);
  assert.deepEqual(history[0], { role: "user", content: "hello" });
  assert.equal(history[1].role, "assistant");
  assert.equal(history[1].toolCalls?.[0]?.id, "c1");
  assert.equal(history[1].toolCalls?.[0]?.name, "echo");
  assert.deepEqual(history[1].toolCalls?.[0]?.arguments, { text: "hi" });
  assert.equal(history[2].role, "tool");
  assert.equal(history[2].toolCallId, "c1");
  assert.equal(history[2].toolName, "echo");
  assert.equal(history[2].content, "hi");
  assert.equal(history[3].content, "done");
});

test("buildContext puts the system prompt first, then history", () => {
  const sessions = new SessionStore(new CarapaceStore(":memory:"));
  sessions.getOrCreate("api:tester", "api");
  sessions.appendUser("api:tester", "hello");
  sessions.appendAssistant("api:tester", "hi back");

  const context = sessions.buildContext("api:tester", "You are Carapace.");
  assert.equal(context.length, 3);
  assert.equal(context[0].role, "system");
  assert.equal(context[0].content, "You are Carapace.");
  assert.equal(context[1].role, "user");
  assert.equal(context[2].content, "hi back");
});

test("list returns sessions newest-first and get finds by id", () => {
  const sessions = new SessionStore(new CarapaceStore(":memory:"));
  sessions.getOrCreate("a:1", "api");
  sessions.getOrCreate("b:2", "telegram");
  sessions.appendUser("a:1", "bump a"); // touches a:1 → most recent

  assert.equal(sessions.list().length, 2);
  assert.equal(sessions.list()[0].id, "a:1");
  assert.equal(sessions.get("b:2")?.channel, "telegram");
  assert.equal(sessions.get("missing"), null);
});