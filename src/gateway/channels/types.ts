// Shared channel contract. Every chat surface (Telegram, raw HTTP, and later
// Discord/WhatsApp/…) implements this, so the gateway can treat them uniformly.
// M0 ships the contract; M1 fills in the real transports.

import type { RouteTable } from "../server.js";

export interface ChannelMessage {
  channel: string;
  senderId: string;
  chatId: string;
  text: string;
  receivedAt: number;
}

export interface ChannelReply {
  text: string;
}

export interface MessageHandler {
  (message: ChannelMessage): Promise<ChannelReply | void>;
}

/** Narrow session-store surface channels may use (satisfied by SessionStore). */
export interface SessionDirectory {
  list(limit?: number): Array<{
    id: string;
    channel: string;
    createdAt: number;
    updatedAt: number;
    metadata: string;
  }>;
  countMessages(sessionId: string): number;
  /** Delete a session (messages cascade). True when it existed. */
  delete(sessionId: string): boolean;
}

export interface ChannelAdapter {
  readonly name: string;
  /**
   * False for reply-in-band channels that cannot receive proactive pushes
   * (announceTarget routing treats them as undeliverable, #27445).
   */
  readonly pushCapable?: boolean;
  /** True when the channel has everything it needs to start (config-wise). */
  isConfigured(): boolean;
  /** One-line status for logs and `carapace doctor`; never includes secret values. */
  describe(): string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Register the callback that turns inbound messages into replies. */
  onMessage(handler: MessageHandler): void;
  /** Push a proactive message to a chat. */
  send(chatId: string, text: string): Promise<void>;
  /** Optional: let HTTP-backed channels mount endpoints on the gateway router. */
  mountRoutes?(routes: RouteTable): void;
}

/** Rejected when a chat's busy queue is full. Channels translate it into a notice. */
export class BusyTurnError extends Error {
  constructor(
    readonly chatKey: string,
    readonly queueLimit: number,
  ) {
    super(`turn queue is full for ${chatKey} (limit ${queueLimit})`);
    this.name = "BusyTurnError";
  }
}