// Scheduler tests (M8): schedule math + the Scheduler against a :memory: store,
// a mock provider, a recording channel adapter, and an injectable clock.
// No network, no real model, no real timers (manual ticks).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import {
  advanceEveryMs,
  nextRunMs,
  parseDurationMs,
  parseSchedule,
  ScheduleError,
} from "../dist/core/schedule.js";
import { Scheduler } from "../dist/gateway/scheduler.js";
import { CarapaceStore } from "../dist/storage/sqlite.js";
import { SessionStore } from "../dist/core/session.js";
import { ToolRegistry } from "../dist/core/tools/registry.js";

// 2026-09-08 is a Tuesday; 10:00 UTC lands in a whole hour in every real tz,
// so minute-only cron assertions are timezone-independent.
const T0 = Date.parse("2026-09-08T10:00:00Z");

function fakeAgent(store) {
  return {
    config: {
      agent: { systemPrompt: "test agent", maxToolIterations: 3 },
      tools: { allowedRoots: [tmpdir()], exec: { timeoutMs: 1_000, denylist: [] } },
    },
    provider: {
      name: "fake",
      complete: async () => ({ text: "job reply", toolCalls: [], stopReason: "final_answer" }),
    },
    tools: new ToolRegistry(),
    sessions: new SessionStore(store),
  };
}

function fakeChannel(name = "telegram") {
  const sent = [];
  return {
    name,
    pushCapable: true,
    sent,
    isConfigured: () => true,
    describe: () => name,
    start: async () => {},
    stop: async () => {},
    onMessage: () => {},
    send: async (chatId, text) => {
      sent.push({ chatId, text });
    },
  };
}

function makeScheduler(store, { channels, now = () => T0, tickMs = 30_000 } = {}) {
  return new Scheduler({ store, agent: fakeAgent(store), channels, now, tickMs, log: () => {} });
}

function addJob(store, overrides = {}) {
  const job = {
    id: "job-1",
    name: "test-job",
    kind: "at",
    spec: "2026-09-08T10:00:00Z",
    prompt: "say hi",
    channel: "telegram",
    chatId: "123",
    enabled: true,
    lastRun: null,
    nextRun: T0,
    state: "idle",
    lastError: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
  store.addAutomation(job);
  return job;
}

// ── schedule math ────────────────────────────────────────────────────────────

test("parseSchedule accepts the three kinds and rejects garbage", () => {
  const at = parseSchedule("at", "2026-09-08T10:00:00Z");
  assert.equal(at.atMs, T0);
  const atLocal = parseSchedule("at", "2026-09-08 10:30");
  assert.equal(typeof atLocal.atMs, "number");

  const every = parseSchedule("every", "5m");
  assert.equal(every.intervalMs, 300_000);
  assert.equal(parseDurationMs("90s"), 90_000);
  assert.equal(parseDurationMs("2000"), 2_000);
  assert.throws(() => parseSchedule("every", "500"), ScheduleError); // below 1s floor
  assert.throws(() => parseSchedule("every", "soon"), ScheduleError);
  assert.throws(() => parseSchedule("at", "not-a-date"), ScheduleError);

  const cron = parseSchedule("cron", "*/15 9-17 * * 1-5");
  assert.ok(cron.cronFields);
  assert.throws(() => parseSchedule("cron", "61 * * * *"), ScheduleError); // minute range
  assert.throws(() => parseSchedule("cron", "* * * *"), ScheduleError); // 4 fields
  assert.throws(() => parseSchedule("cron", "0 0 * * * *"), ScheduleError); // 6 fields
});

test("cron next-run math is minute-granular", () => {
  assert.equal(nextRunMs(parseSchedule("cron", "* * * * *"), T0), T0 + 60_000);
  assert.equal(nextRunMs(parseSchedule("cron", "*/15 * * * *"), T0), T0 + 15 * 60_000);
  // Hour/minute fields, checked against the local calendar so the test is tz-neutral.
  const nineThirty = parseSchedule("cron", "30 9 * * *");
  const got = nextRunMs(nineThirty, T0);
  assert.ok(got > T0);
  const gotDate = new Date(got);
  assert.equal(gotDate.getHours(), 9);
  assert.equal(gotDate.getMinutes(), 30);
  assert.ok(got - T0 <= 25 * 3_600_000);

  const weekdays = parseSchedule("cron", "0 12 * * 1-5");
  const weekday = new Date(nextRunMs(weekdays, T0));
  assert.equal(weekday.getHours(), 12);
  assert.equal(weekday.getMinutes(), 0);
  assert.ok(weekday.getDay() >= 1 && weekday.getDay() <= 5);
  assert.ok(weekday.getTime() > T0);
});

test("vixie-cron semantics: dow 7 == Sunday; restricted dom+dow OR", () => {
  const sunday = new Date(nextRunMs(parseSchedule("cron", "0 12 * * 7"), T0));
  assert.equal(sunday.getDay(), 0);
  assert.ok(sunday.getTime() > T0);

  // dom=13 AND dow=Tuesday both restricted → fires on the 13th OR any Tuesday.
  const either = new Date(nextRunMs(parseSchedule("cron", "0 12 13 * 2"), T0));
  assert.ok(either.getDate() === 13 || either.getDay() === 2);
  assert.ok(either.getTime() > T0);
});

test("advanceEveryMs skips missed intervals while preserving phase", () => {
  assert.equal(advanceEveryMs(1_000, T0, T0 + 50), T0 + 1_000);
  assert.equal(advanceEveryMs(1_000, T0, T0 + 5_200), T0 + 6_000);
});

// ── store guards ─────────────────────────────────────────────────────────────

test("claimAutomation guards against duplicate fires", () => {
  const store = new CarapaceStore(":memory:");
  addJob(store);
  assert.equal(store.claimAutomation("job-1", T0, null), true);
  assert.equal(store.claimAutomation("job-1", T0, null), false); // last_run >= due
  store.setAutomationEnabled("job-1", false);
  assert.equal(store.getAutomation("job-1").enabled, false);
  assert.equal(store.dueAutomations(T0 + 60_000).length, 0);
  const next = store.nextDueAutomation();
  assert.equal(next, null); // disabled rows are never scheduled
});

// ── scheduler behavior ───────────────────────────────────────────────────────

test("one-shot job fires once, delivers, and never refires (incl. restart)", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store);
  const channel = fakeChannel();
  let clock = T0 - 1_000;
  const s1 = makeScheduler(store, { channels: [channel], now: () => clock });
  assert.equal(await s1.tick(), 0); // not due yet

  clock = T0;
  assert.equal(await s1.tick(), 1); // fired
  await s1.waitUntilIdle();

  const job = store.getAutomation("job-1");
  assert.equal(job.state, "done");
  assert.equal(job.lastRun, T0);
  assert.equal(job.nextRun, null);
  assert.deepEqual(channel.sent, [{ chatId: "123", text: "job reply" }]);

  // Reply + prompt persisted in the automation's session.
  const history = store.listMessages("automation:job-1");
  assert.equal(history.length, 2);
  assert.equal(history[0].content, "say hi");
  assert.equal(history[1].content, "job reply");

  // More ticks and a fresh scheduler on the same store: nothing fires again.
  clock = T0 + 60_000;
  assert.equal(await s1.tick(), 0);
  const s2 = makeScheduler(store, { channels: [channel], now: () => clock });
  assert.equal(await s2.tick(), 0);
  await s2.waitUntilIdle();
  assert.equal(channel.sent.length, 1);
});

test("missed one-shot fires exactly once on gateway boot", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { nextRun: T0 - 60_000 });
  const channel = fakeChannel();
  const scheduler = makeScheduler(store, { channels: [channel], now: () => T0, tickMs: 3_600_000 });
  scheduler.start();
  await scheduler.stop(5_000);

  assert.equal(channel.sent.length, 1);
  const job = store.getAutomation("job-1");
  assert.equal(job.state, "done");
  assert.equal(job.lastRun, T0 - 60_000); // the claimed due time, not the wall clock
  assert.equal(job.nextRun, null);

  // Restarting on the same store must not re-fire the done one-shot.
  const second = makeScheduler(store, { channels: [channel], now: () => T0, tickMs: 3_600_000 });
  second.start();
  await second.stop(5_000);
  assert.equal(channel.sent.length, 1);
});

test("every job fires, advances next_run, and fires again on the next interval", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-e", kind: "every", spec: "1s", nextRun: T0 });
  const channel = fakeChannel();
  let clock = T0;
  const scheduler = makeScheduler(store, { channels: [channel], now: () => clock });

  assert.equal(await scheduler.tick(), 1);
  await scheduler.waitUntilIdle();
  assert.equal(channel.sent.length, 1);
  let job = store.getAutomation("job-e");
  assert.equal(job.state, "ok");
  assert.equal(job.nextRun, T0 + 1_000);

  clock = T0 + 500;
  assert.equal(await scheduler.tick(), 0); // not due yet

  clock = T0 + 1_000;
  assert.equal(await scheduler.tick(), 1);
  await scheduler.waitUntilIdle();
  assert.equal(channel.sent.length, 2);
  assert.equal(store.getAutomation("job-e").nextRun, T0 + 2_000);
});

test("recurring jobs skip missed intervals on boot instead of backfilling", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-e2", kind: "every", spec: "1s", nextRun: T0 - 5_000 });
  const channel = fakeChannel();
  const scheduler = makeScheduler(store, { channels: [channel], now: () => T0, tickMs: 3_600_000 });
  scheduler.start();
  await scheduler.stop(5_000);

  // Five missed intervals: zero fires, next_run phase-aligned past `now`.
  assert.equal(channel.sent.length, 0);
  assert.equal(store.getAutomation("job-e2").nextRun, T0 + 1_000);
  assert.equal(store.getAutomation("job-e2").state, "idle");
});

test("cron job fires when its minute arrives and advances one minute", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-c", kind: "cron", spec: "* * * * *", nextRun: T0 });
  const channel = fakeChannel();
  const scheduler = makeScheduler(store, { channels: [channel], now: () => T0 });
  assert.equal(await scheduler.tick(), 1);
  await scheduler.waitUntilIdle();

  assert.equal(channel.sent.length, 1);
  const job = store.getAutomation("job-c");
  assert.equal(job.state, "ok");
  assert.equal(job.nextRun, T0 + 60_000);
});

test("delivery failure records the error; recurring job still advances", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-f", kind: "every", spec: "1m", nextRun: T0 });
  const channel = fakeChannel();
  channel.send = async () => {
    throw new Error("boom");
  };
  const scheduler = makeScheduler(store, { channels: [channel], now: () => T0 });
  assert.equal(await scheduler.tick(), 1);
  await scheduler.waitUntilIdle();

  const job = store.getAutomation("job-f");
  assert.equal(job.state, "error");
  assert.match(job.lastError, /delivery failed: boom/);
  assert.equal(job.nextRun, T0 + 60_000); // retried next interval, not dropped
});

test("undeliverable targets are recorded as errors, never crashed", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-u", channel: "carrier-pigeon", nextRun: T0 });
  addJob(store, { id: "job-api", channel: "api", nextRun: T0 });
  const api = fakeChannel("api");
  api.pushCapable = false; // reply-in-band channel cannot receive pushes
  const scheduler = makeScheduler(store, { channels: [api], now: () => T0 });

  assert.equal(await scheduler.tick(), 2);
  await scheduler.waitUntilIdle();

  const pigeon = store.getAutomation("job-u");
  assert.equal(pigeon.state, "error");
  assert.match(pigeon.lastError, /unknown channel/);
  const apiJob = store.getAutomation("job-api");
  assert.equal(apiJob.state, "error");
  assert.match(apiJob.lastError, /cannot receive proactive pushes/);
});

test("corrupt schedule spec is errored and disabled, not crashed", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-b", kind: "cron", spec: "bogus expression" });
  const scheduler = makeScheduler(store, { channels: [fakeChannel()], now: () => T0 });
  assert.equal(await scheduler.tick(), 0); // never claimed — the spec fails to parse
  await scheduler.waitUntilIdle();

  const job = store.getAutomation("job-b");
  assert.equal(job.state, "error");
  assert.equal(job.enabled, false);
  assert.match(job.lastError, /invalid schedule/);
});

test("runJob fires immediately regardless of the schedule", async () => {
  const store = new CarapaceStore(":memory:");
  addJob(store, { id: "job-m", kind: "every", spec: "1h", nextRun: T0 + 3_600_000 });
  const channel = fakeChannel();
  const scheduler = makeScheduler(store, { channels: [channel], now: () => T0 });

  const result = await scheduler.runJob(store.getAutomation("job-m"));
  assert.equal(result.fired, true);
  assert.equal(result.reply, "job reply");
  assert.equal(result.error, undefined);
  assert.equal(channel.sent.length, 1);

  const job = store.getAutomation("job-m");
  assert.equal(job.lastRun, T0);
  assert.equal(job.nextRun, T0 + 3_600_000); // phase-preserved for future ticks
});

test("describe reports counts and the next due job", () => {
  const store = new CarapaceStore(":memory:");
  const scheduler = makeScheduler(store, { channels: [] });
  assert.match(scheduler.describe(), /no automations/);
  addJob(store, { name: "reminder", nextRun: T0 + 60_000 });
  assert.match(scheduler.describe(), /1 job\(s\) \(1 enabled\)/);
  assert.match(scheduler.describe(), /next due "reminder"/);
});