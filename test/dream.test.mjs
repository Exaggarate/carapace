// Memory dreaming (#67413): prompt shape, chat parsing, config validation, and
// the managed-job upsert (create once → idempotent → in-place rewrite).

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateConfig } from "../dist/config.js";
import { DREAM_JOB_ID, DREAM_JOB_NAME, dreamPrompt, parseDreamChat, upsertDreamJob } from "../dist/core/dream.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";

test("dream: prompt walks the agent through consolidation without touching raw notes", () => {
  const prompt = dreamPrompt();
  assert.match(prompt, /MEMORY\.md/);
  assert.match(prompt, /memory\//);
  assert.match(prompt, /Never delete or rewrite the daily notes/);
  assert.match(prompt, /one-line summary/);
});

test("dream: chat parser accepts CHANNEL:CHATID and rejects the rest", () => {
  assert.deepEqual(parseDreamChat("telegram:12345"), { channel: "telegram", chatId: "12345" });
  assert.deepEqual(parseDreamChat("discord:-100123"), { channel: "discord", chatId: "-100123" });
  assert.equal(parseDreamChat(undefined), null);
  assert.equal(parseDreamChat(""), null);
  assert.equal(parseDreamChat("   "), null);
  assert.equal(parseDreamChat("telegram"), null);
  assert.equal(parseDreamChat("telegram:"), null);
  assert.equal(parseDreamChat(":12345"), null);
});

test("dream: upsert creates the managed job once, stays idempotent, rewrites on config change", () => {
  const store = new CarapaceStore(":memory:");
  try {
    const first = upsertDreamJob(store, { enabled: true, scheduleCron: "0 4 * * *" }, 1_000);
    assert.equal(first.created, true);
    const job = store.findAutomationByName(DREAM_JOB_NAME);
    assert.equal(job?.id, DREAM_JOB_ID);
    assert.equal(job?.kind, "cron");
    assert.equal(job?.spec, "0 4 * * *");
    assert.equal(job?.channel, ""); // headless by default
    assert.equal(job?.enabled, true);

    const repeat = upsertDreamJob(store, { enabled: true, scheduleCron: "0 4 * * *" }, 2_000);
    assert.equal(repeat.created, false);
    assert.equal(repeat.updated, false);

    const changed = upsertDreamJob(store, { enabled: true, scheduleCron: "30 5 * * *", chat: "telegram:42" }, 3_000);
    assert.equal(changed.updated, true);
    const updated = store.findAutomationByName(DREAM_JOB_NAME);
    assert.equal(updated?.id, DREAM_JOB_ID); // id stable across rewrites
    assert.equal(updated?.spec, "30 5 * * *");
    assert.equal(updated?.channel, "telegram");
    assert.equal(updated?.chatId, "42");
  } finally {
    store.close();
  }
});

test("dream: disabled config never creates the job", () => {
  const store = new CarapaceStore(":memory:");
  try {
    const result = upsertDreamJob(store, { enabled: false, scheduleCron: "0 4 * * *" });
    assert.equal(result.created, false);
    assert.equal(result.nextRunMs, null);
    assert.equal(store.findAutomationByName(DREAM_JOB_NAME), null);
  } finally {
    store.close();
  }
});

test("dream: config validation accepts a valid dreaming section and rejects bad cron/chat", () => {
  const good = validateConfig({ memory: { dreaming: { enabled: true, scheduleCron: "0 4 * * *", chat: "telegram:7" } } });
  assert.equal(good.errors.length, 0);
  assert.equal(good.config.memory?.dreaming?.enabled, true);
  assert.equal(good.config.memory?.dreaming?.chat, "telegram:7");

  const headless = validateConfig({ memory: { dreaming: { enabled: true } } });
  assert.equal(headless.errors.length, 0);
  assert.equal(headless.config.memory?.dreaming?.chat, "");

  const badCron = validateConfig({ memory: { dreaming: { enabled: true, scheduleCron: "not a cron" } } });
  assert.equal(badCron.errors.length, 1);
  assert.match(badCron.errors[0], /scheduleCron/);

  const badChat = validateConfig({ memory: { dreaming: { enabled: true, chat: "no-colon" } } });
  assert.equal(badChat.errors.length, 1);
  assert.match(badChat.errors[0], /chat/);

  const disabled = validateConfig({ memory: { dreaming: { enabled: false, scheduleCron: "garbage", chat: "junk" } } });
  assert.equal(disabled.errors.length, 0); // invalid fields only matter when enabled
});