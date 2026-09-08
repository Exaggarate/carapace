// SQLite persistence on Node's built-in node:sqlite (no native dependency downloads).
// M0 schema: sessions + messages. Memory/jobs tables arrive with M1 features.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import type { ScheduleKind } from "../core/schedule.js";

export type MessageRole = "user" | "assistant" | "tool" | "system";

/** One assistant tool request, persisted as JSON in messages.tool_calls. */
export interface StoredToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface SessionRow {
  id: string;
  channel: string;
  createdAt: number;
  updatedAt: number;
  metadata: string;
}

export interface MessageRow {
  id: number;
  sessionId: string;
  role: MessageRole;
  content: string;
  /** role="tool": id of the assistant tool call this row answers. */
  toolCallId: string | null;
  /** role="tool": name of the tool that produced this row. */
  toolName: string | null;
  /** role="assistant": tool calls requested alongside this message. */
  toolCalls: StoredToolCall[] | null;
  createdAt: number;
}

export interface AutomationRow {
  id: string;
  name: string;
  /** "at" (one-shot ISO timestamp), "every" (interval), or "cron" (5-field expr). */
  kind: ScheduleKind;
  /** Spec string as supplied to `parseSchedule` (ISO for at, duration for every, expr for cron). */
  spec: string;
  prompt: string;
  /** Target channel adapter name (e.g. "telegram"). */
  channel: string;
  /** Destination chat id on that channel. */
  chatId: string;
  enabled: boolean;
  /** Epoch ms of the most recent fire (the claimed due time, not actual run time). */
  lastRun: number | null;
  /** Epoch ms of the next scheduled fire; null once a one-shot is done. */
  nextRun: number | null;
  /** idle | running | ok | done | error. */
  state: string;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

const ROLES: readonly string[] = ["user", "assistant", "tool", "system"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  channel    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content      TEXT NOT NULL,
  tool_call_id TEXT,
  tool_name    TEXT,
  tool_calls   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages (session_id, created_at);
CREATE TABLE IF NOT EXISTS channel_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('at', 'every', 'cron')),
  spec       TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  channel    TEXT NOT NULL,
  chat_id    TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  last_run   INTEGER,
  next_run   INTEGER,
  state      TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_next_run ON automations (enabled, next_run);
`;

// Columns added after the M0 schema; applied in-place so pre-M1 databases keep working.
const MIGRATION_SQL = [
  "ALTER TABLE messages ADD COLUMN tool_call_id TEXT",
  "ALTER TABLE messages ADD COLUMN tool_name TEXT",
  "ALTER TABLE messages ADD COLUMN tool_calls TEXT",
];

interface RawSessionRow {
  id: string;
  channel: string;
  created_at: number;
  updated_at: number;
  metadata: string;
}

interface RawMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_calls: string | null;
  created_at: number;
}

interface RawAutomationRow {
  id: string;
  name: string;
  kind: string;
  spec: string;
  prompt: string;
  channel: string;
  chat_id: string;
  enabled: number;
  last_run: number | null;
  next_run: number | null;
  state: string;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

function toAutomationRow(row: RawAutomationRow): AutomationRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ScheduleKind,
    spec: row.spec,
    prompt: row.prompt,
    channel: row.channel,
    chatId: row.chat_id,
    enabled: row.enabled !== 0,
    lastRun: row.last_run,
    nextRun: row.next_run,
    state: row.state,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Parse persisted assistant tool calls; malformed rows degrade to null, never throw. */
function parseToolCalls(raw: string | null): StoredToolCall[] | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const calls: StoredToolCall[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "";
    if (id === "" || name === "") continue;
    const args =
      typeof record.arguments === "object" && record.arguments !== null && !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {};
    calls.push({ id, name, arguments: args });
  }
  return calls.length > 0 ? calls : null;
}

/** Normalize a `SELECT COUNT(*)` result row (bigint or number) to a plain number. */
function countCountRow(row: unknown): number {
  const n = (row as { n?: number | bigint } | undefined)?.n;
  return typeof n === "bigint" ? Number(n) : typeof n === "number" ? n : 0;
}

function toMessageRow(row: RawMessageRow): MessageRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: (ROLES as readonly string[]).includes(row.role) ? (row.role as MessageRole) : "system",
    content: row.content,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    toolCalls: parseToolCalls(row.tool_calls),
    createdAt: row.created_at,
  };
}

export class CarapaceStore {
  private readonly db: DatabaseSync;
  private readonly insertSession: StatementSync;
  private readonly selectSession: StatementSync;
  private readonly touchSessionStmt: StatementSync;
  private readonly insertMessage: StatementSync;
  private readonly selectLastMessage: StatementSync;
  private readonly selectMessages: StatementSync;
  private readonly selectSessions: StatementSync;
  private readonly deleteSessionStmt: StatementSync;
  private readonly countMessagesStmt: StatementSync;
  private readonly countSessionsStmt: StatementSync;
  private readonly countAllMessagesStmt: StatementSync;
  private readonly selectRecentMessages: StatementSync;
  private readonly getChannelStateStmt: StatementSync;
  private readonly setChannelStateStmt: StatementSync;
  private readonly insertAutomation: StatementSync;
  private readonly selectAutomation: StatementSync;
  private readonly selectAutomationByName: StatementSync;
  private readonly selectAutomationByIdPrefix: StatementSync;
  private readonly selectAutomations: StatementSync;
  private readonly deleteAutomationStmt: StatementSync;
  private readonly setAutomationEnabledStmt: StatementSync;
  private readonly claimAutomationStmt: StatementSync;
  private readonly advanceAutomationStmt: StatementSync;
  private readonly setAutomationOutcomeStmt: StatementSync;
  private readonly selectDueAutomationsStmt: StatementSync;
  private readonly selectNextDueAutomationStmt: StatementSync;
  private readonly countAutomationsStmt: StatementSync;
  private readonly countEnabledAutomationsStmt: StatementSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    // WAL: committed state survives crashes and restarts without losing tail writes.
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA_SQL);
    for (const statement of MIGRATION_SQL) {
      try {
        this.db.exec(statement);
      } catch (error) {
        // Expected on M0-era databases: the column already exists.
        if (!String((error as Error).message).includes("duplicate column")) throw error;
      }
    }
    this.insertSession = this.db.prepare(
      "INSERT INTO sessions (id, channel, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)",
    );
    this.selectSession = this.db.prepare(
      "SELECT id, channel, created_at, updated_at, metadata FROM sessions WHERE id = ?",
    );
    this.touchSessionStmt = this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");
    this.insertMessage = this.db.prepare(
      "INSERT INTO messages (session_id, role, content, tool_call_id, tool_name, tool_calls, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.selectLastMessage = this.db.prepare(
      "SELECT id, session_id, role, content, tool_call_id, tool_name, tool_calls, created_at " +
        "FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
    );
    this.selectMessages = this.db.prepare(
      "SELECT id, session_id, role, content, tool_call_id, tool_name, tool_calls, created_at " +
        "FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?",
    );
    this.selectSessions = this.db.prepare(
      "SELECT id, channel, created_at, updated_at, metadata FROM sessions ORDER BY updated_at DESC LIMIT ?",
    );
    this.deleteSessionStmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    this.countMessagesStmt = this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?");
    this.countSessionsStmt = this.db.prepare("SELECT COUNT(*) AS n FROM sessions");
    this.countAllMessagesStmt = this.db.prepare("SELECT COUNT(*) AS n FROM messages");
    this.selectRecentMessages = this.db.prepare(
      "SELECT id, session_id, role, content, tool_call_id, tool_name, tool_calls, created_at " +
        "FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
    );
    this.getChannelStateStmt = this.db.prepare("SELECT value FROM channel_state WHERE key = ?");
    this.setChannelStateStmt = this.db.prepare(
      "INSERT INTO channel_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    );
    this.insertAutomation = this.db.prepare(
      "INSERT OR REPLACE INTO automations " +
        "(id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    this.selectAutomation = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations WHERE id = ?",
    );
    this.selectAutomationByName = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations WHERE name = ? ORDER BY created_at LIMIT 1",
    );
    this.selectAutomationByIdPrefix = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations WHERE id LIKE ? ORDER BY id LIMIT 2",
    );
    this.selectAutomations = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations " +
        "ORDER BY (next_run IS NULL), next_run ASC, created_at ASC",
    );
    this.deleteAutomationStmt = this.db.prepare("DELETE FROM automations WHERE id = ?");
    this.setAutomationEnabledStmt = this.db.prepare(
      "UPDATE automations SET enabled = ?, updated_at = ? WHERE id = ?",
    );
    this.claimAutomationStmt = this.db.prepare(
      "UPDATE automations SET last_run = ?, next_run = ?, state = 'running', last_error = NULL, updated_at = ? " +
        "WHERE id = ? AND enabled = 1 AND (last_run IS NULL OR last_run < ?)",
    );
    this.advanceAutomationStmt = this.db.prepare(
      "UPDATE automations SET next_run = ?, updated_at = ? WHERE id = ? AND enabled = 1 AND next_run IS NOT NULL AND next_run <= ?",
    );
    this.setAutomationOutcomeStmt = this.db.prepare(
      "UPDATE automations SET state = ?, last_error = ?, updated_at = ? WHERE id = ?",
    );
    this.selectDueAutomationsStmt = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run ASC",
    );
    this.selectNextDueAutomationStmt = this.db.prepare(
      "SELECT id, name, kind, spec, prompt, channel, chat_id, enabled, last_run, next_run, state, last_error, created_at, updated_at " +
        "FROM automations WHERE enabled = 1 AND next_run IS NOT NULL ORDER BY next_run ASC LIMIT 1",
    );
    this.countAutomationsStmt = this.db.prepare("SELECT COUNT(*) AS n FROM automations");
    this.countEnabledAutomationsStmt = this.db.prepare("SELECT COUNT(*) AS n FROM automations WHERE enabled = 1");
  }

  createSession(id: string, channel: string, metadata: Record<string, unknown> = {}): void {
    const now = Date.now();
    this.insertSession.run(id, channel, now, now, JSON.stringify(metadata));
  }

  getSession(id: string): SessionRow | null {
    const row = this.selectSession.get(id) as RawSessionRow | undefined;
    if (row === undefined) return null;
    return {
      id: row.id,
      channel: row.channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata,
    };
  }

  touchSession(id: string): void {
    this.touchSessionStmt.run(Date.now(), id);
  }

  appendMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    toolCallId: string | null = null,
    toolName: string | null = null,
    toolCalls: StoredToolCall[] | null = null,
  ): MessageRow {
    this.ensureSession(sessionId);
    this.insertMessage.run(
      sessionId,
      role,
      content,
      toolCallId,
      toolName,
      toolCalls === null ? null : JSON.stringify(toolCalls),
      Date.now(),
    );
    const row = this.selectLastMessage.get(sessionId) as RawMessageRow | undefined;
    if (row === undefined) {
      throw new Error(`appendMessage: insert for session ${sessionId} did not persist`);
    }
    return toMessageRow(row);
  }

  /** Most recently updated sessions, newest first. */
  listSessions(limit: number = 50): SessionRow[] {
    const rows = this.selectSessions.all(limit) as RawSessionRow[];
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata,
    }));
  }

  listMessages(sessionId: string, limit: number = 200): MessageRow[] {
    const rows = this.selectMessages.all(sessionId, limit) as RawMessageRow[];
    return rows.map(toMessageRow);
  }

  /** Remove a session and (by cascade) its messages. True when a row was deleted. */
  deleteSession(id: string): boolean {
    const result = this.deleteSessionStmt.run(id);
    return Number(result.changes) > 0;
  }

  /** Total persisted messages for a session. */
  countMessages(sessionId: string): number {
    const row = this.countMessagesStmt.get(sessionId) as { n?: number | bigint } | undefined;
    const n = row?.n;
    return typeof n === "bigint" ? Number(n) : typeof n === "number" ? n : 0;
  }

  /** Most recent messages of a session, returned oldest → newest (dashboard view, #28300). */
  listRecentMessages(sessionId: string, limit: number = 100): MessageRow[] {
    const rows = this.selectRecentMessages.all(sessionId, limit) as RawMessageRow[];
    return rows.map(toMessageRow).reverse();
  }

  /** Total persisted sessions across all channels (dashboard status). */
  countSessions(): number {
    return countCountRow(this.countSessionsStmt.get());
  }

  /** Total persisted messages across all sessions (dashboard status). */
  countAllMessages(): number {
    return countCountRow(this.countAllMessagesStmt.get());
  }

  /** Channel bookkeeping value (e.g. Telegram update offsets); null when unset. */
  getChannelState(key: string): string | null {
    const row = this.getChannelStateStmt.get(key) as { value?: unknown } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  /** Persist a channel bookkeeping value (upsert). */
  setChannelState(key: string, value: string): void {
    this.setChannelStateStmt.run(key, value, Date.now());
  }

  // ── Automations (M8): persisted scheduled jobs ────────────────────────────

  /** Insert or replace a full automation row (id is the key). */
  addAutomation(job: AutomationRow): void {
    this.insertAutomation.run(
      job.id,
      job.name,
      job.kind,
      job.spec,
      job.prompt,
      job.channel,
      job.chatId,
      job.enabled ? 1 : 0,
      job.lastRun,
      job.nextRun,
      job.state,
      job.lastError,
      job.createdAt,
      job.updatedAt,
    );
  }

  getAutomation(id: string): AutomationRow | null {
    const row = this.selectAutomation.get(id) as RawAutomationRow | undefined;
    return row === undefined ? null : toAutomationRow(row);
  }

  /** First automation created under this name (names are not unique). */
  findAutomationByName(name: string): AutomationRow | null {
    const row = this.selectAutomationByName.get(name) as RawAutomationRow | undefined;
    return row === undefined ? null : toAutomationRow(row);
  }

  /** Resolve a short id prefix; match === null with candidates > 1 means ambiguous. */
  findAutomationByIdPrefix(prefix: string): { match: AutomationRow | null; candidates: number } {
    const rows = this.selectAutomationByIdPrefix.all(`${prefix}%`) as RawAutomationRow[];
    return { match: rows.length === 1 ? toAutomationRow(rows[0] as RawAutomationRow) : null, candidates: rows.length };
  }

  /** All automations: due jobs first (soonest next_run), then one-shot done rows. */
  listAutomations(): AutomationRow[] {
    return (this.selectAutomations.all() as RawAutomationRow[]).map(toAutomationRow);
  }

  deleteAutomation(id: string): boolean {
    return Number(this.deleteAutomationStmt.run(id).changes) > 0;
  }

  setAutomationEnabled(id: string, enabled: boolean): void {
    this.setAutomationEnabledStmt.run(enabled ? 1 : 0, Date.now(), id);
  }

  /**
   * Durable fire guard: atomically record that the job fired for `dueRun` and set
   * its next run. Only succeeds when enabled and last_run < dueRun, so a job can
   * never fire twice for the same scheduled time across ticks or restarts.
   */
  claimAutomation(id: string, dueRun: number, nextRun: number | null): boolean {
    const result = this.claimAutomationStmt.run(dueRun, nextRun, Date.now(), id, dueRun);
    return Number(result.changes) === 1;
  }

  /** Boot catch-up for recurring jobs: skip missed intervals without firing. */
  advanceAutomation(id: string, nextRun: number): boolean {
    return Number(this.advanceAutomationStmt.run(nextRun, Date.now(), id, Date.now()).changes) > 0;
  }

  /** Post-run outcome: ok/done on success, error + message on failure. */
  setAutomationOutcome(id: string, state: string, lastError: string | null): void {
    this.setAutomationOutcomeStmt.run(state, lastError, Date.now(), id);
  }

  /** Enabled jobs whose next_run has arrived (soonest first). */
  dueAutomations(now: number): AutomationRow[] {
    return (this.selectDueAutomationsStmt.all(now) as RawAutomationRow[]).map(toAutomationRow);
  }

  automationCounts(): { total: number; enabled: number } {
    const total = countCountRow(this.countAutomationsStmt.get());
    const enabled = countCountRow(this.countEnabledAutomationsStmt.get());
    return { total, enabled };
  }

  /** Enabled job with the earliest next_run (null when nothing is scheduled). */
  nextDueAutomation(): AutomationRow | null {
    const row = this.selectNextDueAutomationStmt.get() as RawAutomationRow | undefined;
    return row === undefined ? null : toAutomationRow(row);
  }

  close(): void {
    this.db.close();
  }

  /** Auto-create a session shell for callers that message before registering. */
  private ensureSession(id: string): void {
    if (this.getSession(id) === null) {
      this.createSession(id, "unknown", {});
    } else {
      this.touchSession(id);
    }
  }
}