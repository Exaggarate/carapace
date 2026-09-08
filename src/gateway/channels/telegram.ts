// Telegram channel adapter — real transport (M1).
// Long-polls getUpdates via plain fetch, routes allowed inbound messages to the
// gateway's message handler (the agent loop), and replies with sendMessage.
// The bot token comes from config (channels.telegram.botToken) or a SecretRef —
// resolved at runtime, never logged.

import { describeSecretValue, resolveSecret, type CarapaceConfig } from "../../config.js";
import type { ChannelAdapter, ChannelMessage, ChannelReply, MessageHandler } from "./types.js";

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_S = 30;
const HTTP_TIMEOUT_MS = (POLL_TIMEOUT_S + 10) * 1000;
const MAX_MESSAGE_CHARS = 3800;
const SEND_CHUNK_DELAY_MS = 350;
const MAX_BACKOFF_MS = 30_000;

const WELCOME_TEXT =
  "🐢 Carapace is online.\n\n" +
  "Send me any message and I'll answer through the agent loop (tools included).\n" +
  "Commands:\n/id — show this chat's and your sender id\n/help — this text";

export class TelegramApiError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfterMs: number | null,
  ) {
    super(`telegram ${code}: ${description}`);
    this.name = "TelegramApiError";
  }
}

interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramChat {
  id: number;
  type?: string;
}

interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  text?: string;
  date?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";

  private handler: MessageHandler | null = null;
  private running = false;
  private pollAbort: AbortController | null = null;
  private botUsername: string | null = null;
  private readonly chatQueues = new Map<string, Promise<void>>();
  private readonly log: (line: string) => void;

  constructor(
    private readonly config: CarapaceConfig,
    log?: (line: string) => void,
  ) {
    this.log = log ?? ((line: string) => console.log(`[telegram] ${line}`));
  }

  private token(): string | null {
    return resolveSecret(this.config.channels.telegram.botToken);
  }

  isConfigured(): boolean {
    return this.token() !== null;
  }

  describe(): string {
    const { enabled, botToken } = this.config.channels.telegram;
    const bot = this.botUsername === null ? "" : `, bot=@${this.botUsername}`;
    return `enabled=${enabled}, botToken=${describeSecretValue(botToken)}, resolved=${
      this.isConfigured() ? "yes" : "no"
    }, mode=long-poll${bot}`;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    if (!this.config.channels.telegram.enabled) {
      throw new Error("telegram channel is disabled in config (channels.telegram.enabled=false)");
    }
    const token = this.token();
    if (token === null) {
      throw new Error(
        "telegram bot token is not resolvable — set channels.telegram.botToken (or the env/file SecretRef it points at)",
      );
    }
    const me = (await this.call(token, "getMe", {})) as { username?: unknown };
    this.botUsername = typeof me.username === "string" ? me.username : null;
    this.running = true;
    this.pollAbort = new AbortController();
    void this.pollLoop(token);
    this.log(`started (bot=@${this.botUsername ?? "?"}), long-polling getUpdates`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
  }

  async send(chatId: string, text: string): Promise<void> {
    const token = this.token();
    if (token === null) throw new Error("telegram bot token is not resolvable — cannot send");
    const chunks = splitForTelegram(text === "" ? "(empty reply)" : text);
    for (let index = 0; index < chunks.length; index++) {
      await this.call(token, "sendMessage", {
        chat_id: chatId,
        text: chunks[index],
        link_preview_options: { is_disabled: true },
      });
      if (index < chunks.length - 1) await sleep(SEND_CHUNK_DELAY_MS);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Single Bot API call: POST JSON, unwrap the {ok, result} envelope. */
  private async call(
    token: string,
    method: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new TelegramApiError(response.status, `non-JSON response: ${body.slice(0, 200)}`, null);
    }
    const envelope = parsed as {
      ok?: unknown;
      result?: unknown;
      description?: unknown;
      parameters?: { retry_after?: unknown };
    };
    if (envelope.ok !== true) {
      const description = typeof envelope.description === "string" ? envelope.description : `HTTP ${response.status}`;
      const retryAfter =
        typeof envelope.parameters?.retry_after === "number" ? envelope.parameters.retry_after * 1000 : null;
      throw new TelegramApiError(response.status, description, retryAfter);
    }
    return envelope.result;
  }

  /** Long-poll loop: sequential getUpdates, exponential backoff, fatal on auth errors. */
  private async pollLoop(token: string): Promise<void> {
    let offset = 0;
    let backoffMs = 1_000;
    while (this.running) {
      const controller = new AbortController();
      const external = this.pollAbort;
      if (external !== null) {
        external.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      const watchdog = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS + 5_000);
      try {
        const updates = await this.call(
          token,
          "getUpdates",
          {
            ...(offset > 0 ? { offset } : {}),
            timeout: POLL_TIMEOUT_S,
            allowed_updates: ["message"],
          },
          controller.signal,
        );
        backoffMs = 1_000;
        const list = Array.isArray(updates) ? (updates as TelegramUpdate[]) : [];
        for (const update of list) {
          offset = update.update_id + 1;
          this.enqueueUpdate(update);
        }
      } catch (error) {
        if (!this.running) break;
        if (error instanceof TelegramApiError) {
          if (error.code === 401 || error.code === 403) {
            this.running = false;
            this.log(`fatal: ${error.message} — polling stopped (fix the bot token and restart)`);
            break;
          }
          if (error.code === 409) {
            this.log("conflict: another consumer polls this bot (webhook set? second gateway?) — retrying");
          } else {
            this.log(`api error: ${error.message}`);
          }
        } else {
          this.log(`poll failed: ${(error as Error).message}`);
        }
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      } finally {
        clearTimeout(watchdog);
      }
    }
  }

  /** Serialize handling per chat so replies never overtake each other. */
  private enqueueUpdate(update: TelegramUpdate): void {
    const message = update.message;
    if (message === undefined) return;
    const chatId = message.chat === undefined ? "" : String(message.chat.id);
    if (chatId === "") return;
    const previous = this.chatQueues.get(chatId) ?? Promise.resolve();
    const next = previous
      .then(() => this.handleMessage(message, chatId))
      .catch((error: unknown) => this.log(`update handling failed: ${(error as Error).message}`));
    this.chatQueues.set(chatId, next);
    void next.finally(() => {
      if (this.chatQueues.get(chatId) === next) this.chatQueues.delete(chatId);
    });
  }

  private async handleMessage(message: TelegramMessage, chatId: string): Promise<void> {
    const sender = message.from;
    const senderId = sender === undefined ? "unknown" : String(sender.id);
    const username = sender?.username;

    if (!this.isSenderAllowed(senderId, username)) {
      this.log(`ignored message from unauthorized sender ${senderId} in chat ${chatId}`);
      return;
    }

    const text = typeof message.text === "string" ? message.text : "";

    if (text.startsWith("/")) {
      const command = text.split(/[\s@]/)[0] ?? text;
      if (command === "/start" || command === "/help") {
        await this.send(chatId, WELCOME_TEXT);
        return;
      }
      if (command === "/id") {
        await this.send(chatId, `chat id: ${chatId}\nsender id: ${senderId}${username ? `\nusername: @${username}` : ""}`);
        return;
      }
      // Unknown slash commands fall through to the agent like any other text.
    }

    if (text.trim() === "") {
      await this.send(chatId, "I can only process text messages for now.").catch(() => undefined);
      return;
    }
    if (this.handler === null) {
      await this.send(chatId, "carapace is starting up — no message handler is attached yet.").catch(
        () => undefined,
      );
      return;
    }

    void this.sendChatAction(chatId);
    const inbound: ChannelMessage = { channel: "telegram", senderId, chatId, text, receivedAt: Date.now() };
    const reply: ChannelReply | void = await this.handler(inbound);
    if (reply !== undefined && reply.text !== "") {
      await this.send(chatId, reply.text);
    }
  }

  private isSenderAllowed(senderId: string, username: string | undefined): boolean {
    const allowed = this.config.channels.telegram.allowedSenders;
    if (allowed.length === 0) return true;
    for (const entry of allowed) {
      const normalized = entry.trim().toLowerCase();
      if (normalized === "") continue;
      if (normalized === senderId) return true;
      const withoutAt = normalized.startsWith("@") ? normalized.slice(1) : normalized;
      if (username !== undefined && withoutAt === username.toLowerCase()) return true;
    }
    return false;
  }

  private async sendChatAction(chatId: string): Promise<void> {
    const token = this.token();
    if (token === null) return;
    try {
      await this.call(token, "sendChatAction", { chat_id: chatId, action: "typing" });
    } catch {
      // Best effort — typing indicators must never break a reply.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

/** Split long text into Telegram-safe chunks at line/space boundaries. */
function splitForTelegram(text: string): string[] {
  if (text.length <= MAX_MESSAGE_CHARS) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE_CHARS) {
    let cut = rest.lastIndexOf("\n", MAX_MESSAGE_CHARS);
    if (cut < MAX_MESSAGE_CHARS / 2) cut = rest.lastIndexOf(" ", MAX_MESSAGE_CHARS);
    if (cut < MAX_MESSAGE_CHARS / 2) cut = MAX_MESSAGE_CHARS;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest !== "") chunks.push(rest);
  return chunks.length > 0 ? chunks : [text];
}