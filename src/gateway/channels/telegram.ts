// Telegram channel adapter — M0 skeleton.
// The interface contract is fixed here; M1 implements long-poll getUpdates (or
// webhook mode) via fetch and sendMessage for outbound traffic. No network calls
// happen at M0 — this file only proves config wiring and lifecycle shape.

import { describeSecretValue, resolveSecret } from "../../config.js";
import type { CarapaceConfig } from "../../config.js";
import type { ChannelAdapter, MessageHandler } from "./types.js";

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";

  private messageHandler: MessageHandler | null = null;
  private running = false;

  constructor(private readonly config: CarapaceConfig) {}

  isConfigured(): boolean {
    return resolveSecret(this.config.channels.telegram.token) !== null;
  }

  describe(): string {
    const { enabled, token } = this.config.channels.telegram;
    return `enabled=${enabled}, token=${describeSecretValue(token)}, resolved=${
      this.isConfigured() ? "yes" : "no"
    }, mode=long-poll (planned M1)`;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (!this.config.channels.telegram.enabled || !this.isConfigured()) {
      throw new Error(
        "telegram channel is not usable: set channels.telegram.enabled=true and provide a resolvable token",
      );
    }
    this.running = true;
    if (this.messageHandler !== null) {
      // Handler is wired; getUpdates polling takes over dispatch in M1.
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async send(_chatId: string, _text: string): Promise<void> {
    // M1: POST https://api.telegram.org/bot<token>/sendMessage via fetch. No-op at M0.
  }

  get isRunning(): boolean {
    return this.running;
  }
}