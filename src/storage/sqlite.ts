// SQLite persistence on Node's built-in node:sqlite (no native dependency downloads).
// M0 schema: sessions + messages. Memory/jobs tables arrive with M1 features.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";

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
  private readonly getChannelStateStmt: StatementSync;
  private readonly setChannelStateStmt: StatementSync;

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
    this.getChannelStateStmt = this.db.prepare("SELECT value FROM channel_state WHERE key = ?");
    this.setChannelStateStmt = this.db.prepare(
      "INSERT INTO channel_state (key, value, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    );
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

  /** Channel bookkeeping value (e.g. Telegram update offsets); null when unset. */
  getChannelState(key: string): string | null {
    const row = this.getChannelStateStmt.get(key) as { value?: unknown } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  /** Persist a channel bookkeeping value (upsert). */
  setChannelState(key: string, value: string): void {
    this.setChannelStateStmt.run(key, value, Date.now());
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