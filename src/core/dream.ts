// Memory dreaming (#67413): scheduled consolidation of the daily-note log into
// MEMORY.md. The gateway maintains one managed automation job
// ("memory-dreaming") in the durable scheduler store — claimed atomically like
// any automation, so a dream never fires twice, and it survives restarts. The
// job's prompt walks the agent through folding durable facts from recent daily
// notes into MEMORY.md; delivery is optional, and with no memory.dreaming.chat
// the run is headless (the summary lands in the job's session history).

import type { CarapaceStore } from "../storage/sqlite.js";
import { nextRunMs, parseSchedule } from "./schedule.js";

/** Fixed name + id of the managed consolidation job. */
export const DREAM_JOB_NAME = "memory-dreaming";
export const DREAM_JOB_ID = "internal-memory-dreaming";

/** The static dream prompt — the per-turn memory context block carries the data. */
export function dreamPrompt(): string {
  return [
    'Memory consolidation turn ("dreaming"). Tidy the workspace memory now:',
    "1. Read MEMORY.md and the last few dated notes under memory/ (memory_read / file tools).",
    "2. Fold durable facts, decisions, and preferences into MEMORY.md: merge duplicates, drop stale entries, keep it concise — only its first ~150 lines reach future turns. Use the file-write tool for surgery; memory_write only appends.",
    "3. Never delete or rewrite the daily notes themselves — they are the raw log.",
    "4. Finish with a one-line summary of what you consolidated; it is the turn's only output.",
  ].join("\n");
}

/** Parse "CHANNEL:CHATID" (first colon splits); null when absent or malformed. */
export function parseDreamChat(raw: string | undefined): { channel: string; chatId: string } | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const separator = trimmed.indexOf(":");
  if (separator <= 0 || separator === trimmed.length - 1) return null;
  const channel = trimmed.slice(0, separator).trim();
  const chatId = trimmed.slice(separator + 1).trim();
  if (channel === "" || chatId === "") return null;
  return { channel, chatId };
}

export interface DreamJobSpec {
  enabled: boolean;
  scheduleCron: string;
  /** "CHANNEL:CHATID" summary push; absent/empty = headless run. */
  chat?: string;
}

export interface DreamUpsertResult {
  created: boolean;
  updated: boolean;
  /** Next scheduled run epoch ms after the upsert; null when disabled. */
  nextRunMs: number | null;
}

/**
 * Idempotently (re)create the managed dream job from config. Called at gateway
 * boot; config changes rewrite the row in place with the SAME id, so the job's
 * automation:<id> session history survives edits. Throws on an unparseable cron
 * — validateConfig catches malformed schedules first; hand-built configs get
 * the error at the call site.
 */
export function upsertDreamJob(store: CarapaceStore, dream: DreamJobSpec, now: number = Date.now()): DreamUpsertResult {
  if (!dream.enabled) return { created: false, updated: false, nextRunMs: null };
  const schedule = parseSchedule("cron", dream.scheduleCron);
  const next = nextRunMs(schedule, now);
  const target = parseDreamChat(dream.chat);
  const prompt = dreamPrompt();
  const existing = store.findAutomationByName(DREAM_JOB_NAME);
  if (existing === null) {
    store.addAutomation({
      id: DREAM_JOB_ID,
      name: DREAM_JOB_NAME,
      kind: "cron",
      spec: dream.scheduleCron,
      prompt,
      channel: target?.channel ?? "",
      chatId: target?.chatId ?? "",
      enabled: true,
      lastRun: null,
      nextRun: next,
      state: "idle",
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    return { created: true, updated: false, nextRunMs: next };
  }
  const changed =
    existing.spec !== dream.scheduleCron ||
    existing.prompt !== prompt ||
    existing.channel !== (target?.channel ?? "") ||
    existing.chatId !== (target?.chatId ?? "") ||
    !existing.enabled;
  if (!changed) return { created: false, updated: false, nextRunMs: existing.nextRun };
  store.deleteAutomation(existing.id);
  store.addAutomation({
    id: existing.id,
    name: DREAM_JOB_NAME,
    kind: "cron",
    spec: dream.scheduleCron,
    prompt,
    channel: target?.channel ?? "",
    chatId: target?.chatId ?? "",
    enabled: true,
    lastRun: existing.lastRun,
    nextRun: next,
    state: existing.state === "running" ? "idle" : existing.state,
    lastError: existing.lastError,
    createdAt: existing.createdAt,
    updatedAt: now,
  });
  return { created: false, updated: true, nextRunMs: next };
}