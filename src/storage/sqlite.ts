// SQLite persistence on Node's built-in node:sqlite (no native dependency downloads).
// M0 schema: sessions + messages. Memory/jobs tables arrive with M1 features.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";

export type MessageRole = "user" | "assistant" | "tool" | "system";

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
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages (session_id, created_at);
`;

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
  created_at: number;
}

function toMessageRow(row: RawMessageRow): MessageRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: (ROLES as readonly string[]).includes(row.role) ? (row.role as MessageRole) : "system",
    content: row.content,
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

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA_SQL);
    this.insertSession = this.db.prepare(
      "INSERT INTO sessions (id, channel, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?)",
    );
    this.selectSession = this.db.prepare(
      "SELECT id, channel, created_at, updated_at, metadata FROM sessions WHERE id = ?",
    );
    this.touchSessionStmt = this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?");
    this.insertMessage = this.db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    );
    this.selectLastMessage = this.db.prepare(
      "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
    );
    this.selectMessages = this.db.prepare(
      "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?",
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

  appendMessage(sessionId: string, role: MessageRole, content: string): MessageRow {
    this.ensureSession(sessionId);
    this.insertMessage.run(sessionId, role, content, Date.now());
    const row = this.selectLastMessage.get(sessionId) as RawMessageRow | undefined;
    if (row === undefined) {
      throw new Error(`appendMessage: insert for session ${sessionId} did not persist`);
    }
    return toMessageRow(row);
  }

  listMessages(sessionId: string, limit: number = 200): MessageRow[] {
    const rows = this.selectMessages.all(sessionId, limit) as RawMessageRow[];
    return rows.map(toMessageRow);
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