// Session store: conversation identity + persisted message history + context assembly.
// Wraps the SQLite store. The agent loop reads context through buildContext() and
// appends turns through the typed helpers; assistant tool calls persist as JSON and
// round-trip losslessly through history().

import type { ChatMessage, ToolCallRequest } from "./agent.js";
import { CarapaceStore, type MessageRow, type SessionRow, type StoredToolCall } from "../storage/sqlite.js";

export class SessionStore {
  constructor(private readonly store: CarapaceStore) {}

  /** Create the session when unseen; touch updated_at when it already exists. */
  getOrCreate(sessionId: string, channel: string, metadata: Record<string, unknown> = {}): SessionRow {
    const existing = this.store.getSession(sessionId);
    if (existing !== null) {
      this.store.touchSession(sessionId);
      return existing;
    }
    this.store.createSession(sessionId, channel, metadata);
    const created = this.store.getSession(sessionId);
    if (created === null) {
      throw new Error(`session ${sessionId} vanished immediately after creation`);
    }
    return created;
  }

  get(sessionId: string): SessionRow | null {
    return this.store.getSession(sessionId);
  }

  /** Most recently updated sessions, newest first. */
  list(limit: number = 50): SessionRow[] {
    return this.store.listSessions(limit);
  }

  /** Delete a session (messages cascade). True when it existed. */
  delete(sessionId: string): boolean {
    return this.store.deleteSession(sessionId);
  }

  /** Persisted message count for a session. */
  countMessages(sessionId: string): number {
    return this.store.countMessages(sessionId);
  }

  /** Persisted history in conversation order (oldest → newest). */
  history(sessionId: string, limit: number = 200): ChatMessage[] {
    return this.store.listMessages(sessionId, limit).map(rowToChatMessage);
  }

  appendUser(sessionId: string, text: string): void {
    this.store.appendMessage(sessionId, "user", text);
  }

  appendAssistant(sessionId: string, text: string, toolCalls?: ToolCallRequest[]): void {
    const stored: StoredToolCall[] | null =
      toolCalls === undefined
        ? null
        : toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments }));
    this.store.appendMessage(sessionId, "assistant", text, null, null, stored);
  }

  appendToolResult(sessionId: string, toolCallId: string, toolName: string, output: string): void {
    this.store.appendMessage(sessionId, "tool", output, toolCallId, toolName);
  }

  /** System prompt first, then persisted history (tool results included). */
  buildContext(sessionId: string, systemPrompt: string, maxMessages: number = 200): ChatMessage[] {
    return [{ role: "system", content: systemPrompt }, ...this.history(sessionId, maxMessages)];
  }
}

function rowToChatMessage(row: MessageRow): ChatMessage {
  const message: ChatMessage = { role: row.role, content: row.content };
  if (row.role === "assistant" && row.toolCalls !== null) {
    message.toolCalls = row.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
  }
  if (row.role === "tool") {
    message.toolCallId = row.toolCallId ?? "";
    message.toolName = row.toolName ?? "";
  }
  return message;
}