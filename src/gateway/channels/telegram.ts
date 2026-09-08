// Telegram channel adapter — real transport (M1).
// Long-polls getUpdates via plain fetch, routes allowed inbound messages to the
// gateway's message handler (the agent loop), and replies with sendMessage.
// The bot token comes from config (channels.telegram.botToken) or a SecretRef —
// resolved at runtime, never logged.
// M2: inbound photos, documents and voice notes are downloaded into
// channels.telegram.mediaDir and handed to the agent as context paths; captions
// ride along as the message text. getUpdates offsets are persisted through an
// OffsetPersistence store so a restart resumes exactly where processing stopped.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describeSecretValue, expandTilde, resolveSecret, type CarapaceConfig } from "../../config.js";
import { BusyTurnError, type ChannelAdapter, type ChannelMessage, type ChannelReply, type MessageHandler, type SessionDirectory } from "./types.js";

const API_BASE = "https://api.telegram.org";
const POLL_TIMEOUT_S = 30;
const HTTP_TIMEOUT_MS = (POLL_TIMEOUT_S + 10) * 1000;
const MAX_MESSAGE_CHARS = 3800;
const SEND_CHUNK_DELAY_MS = 350;
const MAX_BACKOFF_MS = 30_000;
/** Bot API getFile/download hard cap for standard bots. */
const BOT_FILE_LIMIT_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_MEDIA_DIR = "~/.carapace/workspace/media";
/** channel_state key holding the last contiguously processed update id. */
const OFFSET_KEY = "telegram:update_offset";
/** How long stop() waits for in-flight updates before giving up (best effort). */
const PENDING_DRAIN_MS = 10_000;

const WELCOME_TEXT =
  "🐢 Carapace is online.\n\n" +
  "Send me any message — text, photos, documents or voice — and I'll answer through the agent loop (tools included).\n" +
  "Commands:\n/id — show this chat's and your sender id\n/sessions — list active sessions\n/reset — wipe this chat's session history\n/help — this text";

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
  caption?: string;
  date?: number;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
}

interface TelegramPhotoSize {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

interface TelegramDocument {
  file_id?: string;
  file_unique_id?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

interface TelegramVoice {
  file_id?: string;
  file_unique_id?: string;
  file_size?: number;
  mime_type?: string;
  duration?: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** One downloadable inbound attachment, parsed from a Telegram message. */
export interface TelegramMediaItem {
  kind: "photo" | "document" | "voice";
  fileId: string;
  /** Stable unique id from Telegram — used in saved file names. */
  fileUniqueId: string;
  /** Original file name (documents only). */
  fileName: string | null;
  mimeType: string | null;
  /** Bytes as reported by Telegram, when present. */
  size: number | null;
  /** Audio length in seconds (voice only). */
  durationSeconds: number | null;
}

function idOr(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function sizeOr(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse inbound media attachments; photo arrays collapse to the largest size. */
export function mediaItemsFromMessage(message: TelegramMessage): TelegramMediaItem[] {
  const items: TelegramMediaItem[] = [];
  const photo = message.photo;
  if (Array.isArray(photo) && photo.length > 0) {
    let largest: TelegramPhotoSize = photo[0] ?? {};
    for (const candidate of photo) {
      if ((candidate.file_size ?? 0) > (largest.file_size ?? 0)) largest = candidate;
    }
    const fileId = idOr(largest.file_id, "");
    if (fileId !== "") {
      items.push({
        kind: "photo",
        fileId,
        fileUniqueId: idOr(largest.file_unique_id, fileId),
        fileName: null,
        mimeType: "image/jpeg",
        size: sizeOr(largest.file_size),
        durationSeconds: null,
      });
    }
  }
  const document = message.document;
  if (document !== undefined) {
    const fileId = idOr(document.file_id, "");
    if (fileId !== "") {
      items.push({
        kind: "document",
        fileId,
        fileUniqueId: idOr(document.file_unique_id, fileId),
        fileName:
          typeof document.file_name === "string" && document.file_name.trim() !== ""
            ? document.file_name
            : null,
        mimeType: typeof document.mime_type === "string" ? document.mime_type : null,
        size: sizeOr(document.file_size),
        durationSeconds: null,
      });
    }
  }
  const voice = message.voice;
  if (voice !== undefined) {
    const fileId = idOr(voice.file_id, "");
    if (fileId !== "") {
      items.push({
        kind: "voice",
        fileId,
        fileUniqueId: idOr(voice.file_unique_id, fileId),
        fileName: null,
        mimeType: typeof voice.mime_type === "string" ? voice.mime_type : "audio/ogg",
        size: sizeOr(voice.file_size),
        durationSeconds: typeof voice.duration === "number" && voice.duration >= 0 ? voice.duration : null,
      });
    }
  }
  return items;
}

/** Strip path separators and control characters from an untrusted file name. */
export function sanitizeMediaFileName(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim();
  const safe = cleaned === "" ? fallback : cleaned;
  return safe.length > 64 ? safe.slice(0, 64) : safe;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Saved file name: kind + unique id prefix keeps names unique and sorted. */
function mediaFileName(item: TelegramMediaItem, telegramPath: string): string {
  if (item.kind === "photo") return `photo_${item.fileUniqueId}.jpg`;
  if (item.kind === "voice") return `voice_${item.fileUniqueId}.ogg`;
  const original =
    item.fileName ?? sanitizeMediaFileName(basename(telegramPath), "file.bin");
  return `doc_${item.fileUniqueId}_${sanitizeMediaFileName(original, "file.bin")}`;
}

function formatAge(ms: number): string {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface TelegramChannelOptions {
  log?: (line: string) => void;
  /** Test seam: replaces fetch for Bot API calls and file downloads. */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Session directory for /sessions and /reset (absent in doctor mode). */
  sessions?: SessionDirectory;
  /** Offset persistence for restart-safe update processing (wired by the runtime). */
  offsetStore?: OffsetPersistence;
}

/** Minimal persistence for the last contiguously processed update id. */
export interface OffsetPersistence {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class TelegramChannel implements ChannelAdapter {
  readonly name = "telegram";

  private handler: MessageHandler | null = null;
  private running = false;
  private pollAbort: AbortController | null = null;
  private botUsername: string | null = null;
  private readonly log: (line: string) => void;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly sessions: SessionDirectory | null;
  private readonly offsetStore: OffsetPersistence | null;
  /** Last contiguously processed update id (-1 before anything is processed). */
  private processedThrough = -1;
  /** True once the frontier has been seeded for this process lifetime. */
  private frontierSeeded = false;
  private readonly completedIds = new Set<number>();
  private readonly inFlightIds = new Set<number>();
  private readonly pendingUpdates = new Set<Promise<void>>();

  constructor(
    private readonly config: CarapaceConfig,
    options: TelegramChannelOptions = {},
  ) {
    this.log = options.log ?? ((line: string) => console.log(`[telegram] ${line}`));
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sessions = options.sessions ?? null;
    this.offsetStore = options.offsetStore ?? null;
  }

  /** Where inbound media is saved (lazy default so hand-built configs still work). */
  private mediaDir(): string {
    return expandTilde(this.config.channels.telegram.mediaDir ?? DEFAULT_MEDIA_DIR);
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
    }, mode=long-poll, media=${this.mediaDir()}${bot}`;
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
    this.restoreOffset();
    this.running = true;
    this.pollAbort = new AbortController();
    void this.pollLoop(token);
    this.log(`started (bot=@${this.botUsername ?? "?"}), long-polling getUpdates`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    // Give in-flight updates a bounded chance to finish; the offset frontier only
    // advances past them once they truly completed, so a crash just redelivers.
    const pending = [...this.pendingUpdates];
    if (pending.length === 0) return;
    await Promise.race([Promise.allSettled(pending), sleep(PENDING_DRAIN_MS)]);
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
    const response = await this.fetchImpl(`${API_BASE}/bot${token}/${method}`, {
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
    let backoffMs = 1_000;
    while (this.running) {
      // Confirm only the contiguous frontier — a crash redelivers everything still
      // in flight instead of losing it.
      const offset = this.processedThrough + 1;
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
          this.trackUpdate(update);
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
  /** Hand an update to processing exactly once; redeliveries only re-confirm. */
  private trackUpdate(update: TelegramUpdate): void {
    const id = update.update_id;
    if (id <= this.processedThrough || this.completedIds.has(id) || this.inFlightIds.has(id)) {
      this.markProcessed(id);
      return;
    }
    this.inFlightIds.add(id);
    this.ensureFrontierSeeded(id);
    const task = this.processUpdate(update)
      .catch((error: unknown) => this.log(`update handling failed: ${(error as Error).message}`))
      .finally(() => {
        this.inFlightIds.delete(id);
        this.pendingUpdates.delete(task);
      });
    this.pendingUpdates.add(task);
  }

  /** Process one update end-to-end, then confirm it for restart-safety. Public for tests. */
  async processUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    this.ensureFrontierSeeded(update.update_id);
    if (message === undefined || message.chat === undefined) {
      this.markProcessed(update.update_id);
      return;
    }
    // Per-chat ordering is the runtime busy gate's job; media downloads and
    // command replies may interleave safely.
    await this.handleIncoming(message).catch((error: unknown) =>
      this.log(`update handling failed: ${(error as Error).message}`),
    );
    this.markProcessed(update.update_id);
  }

  /** Restore the last contiguously processed update id from the offset store. */
  private restoreOffset(): void {
    const stored = this.offsetStore?.get(OFFSET_KEY) ?? null;
    this.processedThrough = stored !== null && /^\d+$/.test(stored) ? Number.parseInt(stored, 10) : -1;
  }

  /**
   * Seed the contiguous frontier from the first fresh delivery of a process
   * lifetime (Telegram batches are ascending, so that id is the batch minimum):
   * everything before it was confirmed by a previous process or already expired.
   */
  private ensureFrontierSeeded(updateId: number): void {
    if (this.frontierSeeded) return;
    this.frontierSeeded = true;
    if (this.processedThrough < 0) this.processedThrough = updateId - 1;
  }

  /** Record completion; persist the contiguous frontier (never a gappy one). */
  private markProcessed(updateId: number): void {
    this.completedIds.add(updateId);
    while (this.completedIds.has(this.processedThrough + 1)) {
      this.processedThrough += 1;
      this.completedIds.delete(this.processedThrough);
    }
    if (this.processedThrough >= 0 && this.offsetStore !== null) {
      this.offsetStore.set(OFFSET_KEY, String(this.processedThrough));
    }
  }

  /** Process one inbound Telegram message end-to-end. Public for tests and reuse. */
  async handleIncoming(message: TelegramMessage): Promise<void> {
    const chatId = message.chat === undefined ? "" : String(message.chat.id);
    if (chatId === "") return;
    const sender = message.from;
    const senderId = sender === undefined ? "unknown" : String(sender.id);
    const username = sender?.username;

    if (!this.isSenderAllowed(senderId, username)) {
      this.log(`ignored message from unauthorized sender ${senderId} in chat ${chatId}`);
      return;
    }

    const rawText = typeof message.text === "string" ? message.text : "";

    if (rawText.startsWith("/")) {
      const command = rawText.split(/[\s@]/)[0] ?? rawText;
      if (command === "/start" || command === "/help") {
        await this.send(chatId, WELCOME_TEXT);
        return;
      }
      if (command === "/id") {
        await this.send(chatId, `chat id: ${chatId}\nsender id: ${senderId}${username ? `\nusername: @${username}` : ""}`);
        return;
      }
      if (command === "/sessions") {
        await this.send(chatId, this.sessionsText());
        return;
      }
      if (command === "/reset") {
        await this.resetSession(chatId);
        return;
      }
      // Unknown slash commands fall through to the agent like any other text.
    }

    const mediaText = rawText === "" ? await this.collectMedia(message) : null;
    const text = mediaText ?? rawText;

    if (text.trim() === "") {
      await this.send(chatId, "I can only process text, photos, documents and voice messages for now.").catch(() => undefined);
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
    let reply: ChannelReply | void;
    try {
      reply = await this.handler(inbound);
    } catch (error) {
      if (error instanceof BusyTurnError) {
        await this.send(
          chatId,
          `⚠️ I'm still working on an earlier message and my queue for this chat is full (${error.queueLimit} waiting) — try again in a moment.`,
        ).catch(() => undefined);
        return;
      }
      throw error;
    }
    if (reply !== undefined && reply.text !== "") {
      await this.send(chatId, reply.text);
    }
  }

  /** Download inbound attachments into mediaDir; returns the context text for the agent. */
  private async collectMedia(message: TelegramMessage): Promise<string | null> {
    const items = mediaItemsFromMessage(message);
    if (items.length === 0) return null;
    const token = this.token();
    const lines: string[] = [];
    if (token === null) {
      lines.push("[media] bot token unresolved — attachments not saved");
    } else {
      for (const item of items) {
        try {
          const saved = await this.downloadMedia(token, item);
          const bits: string[] = [];
          if (item.kind === "document" && item.fileName !== null) bits.push(item.fileName);
          if (item.mimeType !== null) bits.push(item.mimeType);
          bits.push(humanBytes(saved.bytes));
          if (item.durationSeconds !== null) bits.push(`${item.durationSeconds}s`);
          lines.push(`[media] ${item.kind} → ${saved.path} (${bits.join(", ")})`);
        } catch (error) {
          lines.push(`[media] ${item.kind} unavailable (${(error as Error).message})`);
        }
      }
    }
    const caption = typeof message.caption === "string" ? message.caption : "";
    return caption.trim() === "" ? lines.join("\n") : `${lines.join("\n")}\n\n${caption}`;
  }

  /** getFile + file download into mediaDir. Throws on any failure; the caller degrades. */
  private async downloadMedia(token: string, item: TelegramMediaItem): Promise<{ path: string; bytes: number }> {
    if (item.size !== null && item.size > BOT_FILE_LIMIT_BYTES) {
      throw new Error(`file too large (${humanBytes(item.size)}; Bot API limit is 20 MB)`);
    }
    const info = (await this.call(token, "getFile", { file_id: item.fileId })) as {
      file_path?: unknown;
      file_size?: unknown;
    };
    const filePath = typeof info.file_path === "string" ? info.file_path : "";
    if (filePath === "") {
      throw new Error("telegram returned no file_path (file may exceed the 20 MB Bot API limit)");
    }
    const fileSize = typeof info.file_size === "number" ? info.file_size : item.size;
    if (fileSize !== null && fileSize > BOT_FILE_LIMIT_BYTES) {
      throw new Error(`file too large (${humanBytes(fileSize)}; Bot API limit is 20 MB)`);
    }

    mkdirSync(this.mediaDir(), { recursive: true });
    const target = join(this.mediaDir(), mediaFileName(item, filePath));

    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}/file/bot${token}/${filePath}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(watchdog);
    }
    if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > BOT_FILE_LIMIT_BYTES) {
      throw new Error(`download exceeded the 20 MB limit (${humanBytes(bytes.byteLength)})`);
    }
    writeFileSync(target, bytes);
    return { path: target, bytes: bytes.byteLength };
  }

  /** /reset — wipe this chat's session so the next message starts fresh. */
  private async resetSession(chatId: string): Promise<void> {
    if (this.sessions === null) {
      await this.send(chatId, "Session store unavailable — /reset needs the full gateway runtime.").catch(() => undefined);
      return;
    }
    const existed = this.sessions.delete(`telegram:${chatId}`);
    await this.send(
      chatId,
      existed
        ? "🧹 Session reset — this chat's history is cleared; your next message starts a fresh conversation."
        : "🧹 Session reset — nothing to clear; your next message starts a fresh conversation.",
    ).catch(() => undefined);
  }

  /** /sessions — the ten most recently active sessions with message counts. */
  private sessionsText(): string {
    const directory = this.sessions;
    if (directory === null) {
      return "Session store unavailable — /sessions needs the full gateway runtime.";
    }
    const sessions = directory.list(10);
    if (sessions.length === 0) return "No sessions yet — send me a message to start one.";
    const lines = sessions.map(
      (session) =>
        `${session.id} · ${directory.countMessages(session.id)} msg · updated ${formatAge(Date.now() - session.updatedAt)}`,
    );
    return ["📚 Sessions (10 most recent):", ...lines].join("\n");
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