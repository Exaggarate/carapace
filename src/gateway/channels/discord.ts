// Discord channel adapter (M6) — real transport, zero runtime dependencies.
// Gateway: Node 22's built-in WebSocket connects to wss://gateway.discord.dev/?v=10&encoding=json,
// identifies with the bot token (channels.discord.botToken — SecretRef resolved at runtime,
// never logged), heartbeats on the server-provided heartbeat_interval, resumes with
// session_id+seq after reconnects, and turns MESSAGE_CREATE dispatches (bot authors and
// webhook chatter ignored) into gateway messages → the agent loop → replies posted back
// with REST POST /channels/{id}/messages (Authorization: Bot <token>).
// REST sends run through a serialized queue with minimal rate-limit handling:
// x-ratelimit-remaining/reset-after headers set a cooldown, a 429 body's retry_after
// triggers exactly one delayed retry.
// Privileged intents: the identify payload requests GUILD_MESSAGES | DIRECT_MESSAGES |
// MESSAGE_CONTENT — the MESSAGE CONTENT INTENT toggle must be enabled in the developer
// portal or guild message content arrives empty (see README + docs/index.md).

import { describeSecretValue, resolveSecret, type CarapaceConfig, type DiscordChannelConfig } from "../../config.js";
import { BusyTurnError, type ChannelAdapter, type ChannelMessage, type ChannelReply, type MessageHandler } from "./types.js";

const DEFAULT_GATEWAY_URL = "wss://gateway.discord.dev/?v=10&encoding=json";
const DEFAULT_REST_BASE = "https://discord.com/api/v10";
/** GUILD_MESSAGES (1<<9) | DIRECT_MESSAGES (1<<7) | MESSAGE_CONTENT (1<<15). */
const INTENTS = (1 << 9) | (1 << 7) | (1 << 15);
/** Discord message content hard cap. */
const MAX_CONTENT_CHARS = 2000;
const REST_TIMEOUT_MS = 30_000;
/** First reconnect backoff; doubles per failed attempt up to the cap, resets on READY/RESUMED. */
const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 30_000;
/** INVALID_SESSION (d=false) mandates a fresh identify after 1–5 s. */
const HARD_RESTART_DELAY_MS = 1_000;
/** start() resolves once READY arrives; past this deadline the start attempt fails. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Default heartbeat used only when HELLO omits heartbeat_interval (it never does). */
const DEFAULT_HEARTBEAT_MS = 41_250;

// Gateway opcodes (discord developer docs).
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

/** Close code that can never recover — an invalid bot token; reconnecting is pointless. */
const CLOSE_AUTH_FAILED = 4004;

const BUSY_NOTICE = "⏳ I'm still working on an earlier message and the queue for this chat is full — try again in a moment.";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`discord ${status}: ${description}`);
    this.name = "DiscordApiError";
  }
}

export interface DiscordSocketEvents {
  open: { type: "open" };
  message: { type: "message"; data: unknown };
  close: { type: "close"; code: number; reason: string; wasClean: boolean };
  error: { type: "error"; message?: string };
}

export type DiscordSocketListener<K extends keyof DiscordSocketEvents> = (event: DiscordSocketEvents[K]) => void;

/** Minimal WebSocket surface the gateway connection needs (satisfied by Node 22's built-in). */
export interface DiscordWebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof DiscordSocketEvents>(type: K, listener: DiscordSocketListener<K>): void;
}

export type DiscordWebSocketFactory = (url: string) => DiscordWebSocket;

export interface DiscordChannelOptions {
  /** Test seam: fetch for REST calls (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /** Test seam: WebSocket factory (defaults to Node 22's global WebSocket). */
  webSocketFactory?: DiscordWebSocketFactory;
  /** Test seam: gateway URL override (mock server). */
  gatewayUrl?: string;
  /** Test seam: REST base override (mock server). */
  restBase?: string;
}

interface GatewayPacket {
  op: number;
  d?: unknown;
  s?: number;
  t?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Split a reply into Discord-sized chunks at whitespace when possible (2000-char cap). */
export function splitDiscordContent(text: string, limit: number = MAX_CONTENT_CHARS): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest !== "") chunks.push(rest);
  return chunks.length > 0 ? chunks : [text.slice(0, limit)];
}

export interface DiscordProbeResult {
  ok: boolean;
  /** True when the failure is a definite config problem (token rejected). */
  fatal: boolean;
  detail: string;
}

/**
 * Doctor probe: who does this token authenticate as (REST GET /users/@me)?
 * Verifies gateway/REST reachability without opening a websocket. Never logs the token.
 */
export async function probeDiscordToken(
  token: string,
  restBase: string = DEFAULT_REST_BASE,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordProbeResult> {
  try {
    const response = await fetchImpl(`${restBase}/users/@me`, {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 200) {
      const user = (await response.json().catch(() => ({}))) as { username?: unknown };
      const name = typeof user.username === "string" ? user.username : "bot";
      return { ok: true, fatal: false, detail: `gateway reachable; authenticated as ${name}` };
    }
    if (response.status === 401) {
      return {
        ok: false,
        fatal: true,
        detail: "token rejected (401) — create a fresh bot token in the developer portal",
      };
    }
    return { ok: false, fatal: false, detail: `gateway returned ${response.status} ${response.statusText}` };
  } catch (error) {
    return { ok: false, fatal: false, detail: `gateway unreachable: ${(error as Error).message}` };
  }
}

/** Serialized REST message queue with minimal rate-limit handling (headers + one 429 retry). */
class DiscordRestSender {
  private chain: Promise<unknown> = Promise.resolve();
  /** Cooldown learned from rate-limit headers/429 bodies; applies before the next send. */
  private cooldownUntil = 0;

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly token: string,
    private readonly restBase: string,
  ) {}

  /** Queue POST /channels/{id}/messages; sends run one at a time in order. */
  postMessage(channelId: string, content: string): Promise<void> {
    const run = this.chain.then(() => this.sendOne(channelId, content));
    this.chain = run.catch(() => undefined); // a failed send must not poison the queue
    return run;
  }

  private async sendOne(channelId: string, content: string): Promise<void> {
    const cooldown = this.cooldownUntil - Date.now();
    if (cooldown > 0) await sleep(cooldown);
    for (let attempt = 1; ; attempt += 1) {
      const response = await this.fetchImpl(
        `${this.restBase}/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bot ${this.token}`, "content-type": "application/json" },
          body: JSON.stringify({ content }),
          signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        },
      );
      if (response.status === 429 && attempt === 1) {
        const body = (await response.json().catch(() => ({}))) as { retry_after?: unknown };
        const retryAfterSec = typeof body.retry_after === "number" && body.retry_after >= 0 ? body.retry_after : 1;
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + retryAfterSec * 1000);
        await sleep(retryAfterSec * 1000);
        continue;
      }
      if (response.status >= 300) {
        const body = (await response.json().catch(() => ({}))) as { message?: unknown };
        const detail = typeof body.message === "string" ? body.message : response.statusText || "request failed";
        throw new DiscordApiError(response.status, detail);
      }
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        const resetAfter = Number.parseFloat(response.headers.get("x-ratelimit-reset-after") ?? "1");
        this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + (Number.isFinite(resetAfter) ? resetAfter : 1) * 1000);
      }
      return;
    }
  }
}

export class DiscordChannel implements ChannelAdapter {
  readonly name = "discord";
  /** REST sends make proactive pushes possible (announceTarget routing, #27445). */
  readonly pushCapable = true;

  private messageHandler: MessageHandler | null = null;
  private readonly shape: DiscordChannelConfig;
  private readonly gatewayUrl: string;
  private readonly restBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly webSocketFactory: DiscordWebSocketFactory;

  private token: string | null = null;
  private sender: DiscordRestSender | null = null;
  private ws: DiscordWebSocket | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private heartbeatTimer: unknown = null;
  private awaitingHeartbeatAck = false;
  private reconnectTimer: unknown = null;
  private backoffMs = BACKOFF_START_MS;
  /** One-shot delay override (e.g. the INVALID_SESSION hard-restart pause). */
  private forcedDelayMs: number | null = null;
  private running = false;
  private connected = false;
  private fatalReason: string | null = null;
  private startWaiter: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private startDeadline: unknown = null;

  constructor(config: CarapaceConfig, options: DiscordChannelOptions = {}) {
    // Hand-built configs (tests) may omit channels.discord entirely.
    this.shape =
      config.channels?.discord ?? { enabled: false, botToken: { env: "CARAPACE_DISCORD_TOKEN" } };
    this.gatewayUrl = options.gatewayUrl ?? DEFAULT_GATEWAY_URL;
    this.restBase = options.restBase ?? DEFAULT_REST_BASE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url) as unknown as DiscordWebSocket);
  }

  isConfigured(): boolean {
    return this.shape.enabled && resolveSecret(this.shape.botToken) !== null;
  }

  describe(): string {
    // Never includes the token value itself.
    return `enabled=${this.shape.enabled}, botToken=${describeSecretValue(this.shape.botToken)}, state=${this.stateLabel()}`;
  }

  private stateLabel(): string {
    if (this.fatalReason !== null) return `fatal (${this.fatalReason})`;
    if (!this.running) return "stopped";
    return this.connected ? "connected" : "connecting";
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** Connect and resolve once the gateway says READY (or fail past the deadline). */
  async start(): Promise<void> {
    if (this.running) throw new Error("discord channel already started");
    if (!this.shape.enabled) throw new Error("discord channel is disabled (channels.discord.enabled=false)");
    const token = resolveSecret(this.shape.botToken);
    if (token === null) throw new Error("discord botToken did not resolve — set channels.discord.botToken (SecretRef)");
    this.token = token;
    this.sender = new DiscordRestSender(this.fetchImpl, token, this.restBase);
    this.running = true;
    this.fatalReason = null;
    this.backoffMs = BACKOFF_START_MS;
    const gate = new Promise<void>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    this.startDeadline = setTimeout(() => {
      const waiter = this.startWaiter;
      this.startWaiter = null;
      this.halt(`discord gateway did not become ready within ${CONNECT_TIMEOUT_MS / 1000}s`);
      waiter?.reject(new Error(`discord gateway did not become ready within ${CONNECT_TIMEOUT_MS / 1000}s`));
    }, CONNECT_TIMEOUT_MS);
    this.scheduleReconnect(0);
    try {
      await gate;
    } finally {
      this.startWaiter = null;
      if (this.startDeadline !== null) {
        clearTimeout(this.startDeadline);
        this.startDeadline = null;
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.connected = false;
    this.settleStart(new Error("discord channel stopped before the gateway became ready"));
    this.halt(null);
    this.sender = null;
  }

  /** Proactive push (announceTarget routing) — same REST path as replies. */
  async send(chatId: string, text: string): Promise<void> {
    await this.sendChunks(chatId, text);
  }

  /** Stop timers and the socket without settling the start gate. */
  private halt(reason: string | null): void {
    this.running = false;
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.startDeadline !== null) {
      clearTimeout(this.startDeadline);
      this.startDeadline = null;
    }
    this.detachSocket();
    if (reason !== null) this.fatalReason = reason;
  }

  private settleStart(error?: Error): void {
    const waiter = this.startWaiter;
    if (waiter === null) return;
    this.startWaiter = null;
    if (this.startDeadline !== null) {
      clearTimeout(this.startDeadline);
      this.startDeadline = null;
    }
    if (error === undefined) waiter.resolve();
    else waiter.reject(error);
  }

  private scheduleReconnect(delayMs: number): void {
    if (!this.running || this.fatalReason !== null || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private connect(): void {
    if (!this.running || this.fatalReason !== null) return;
    this.connected = false;
    this.detachSocket();
    const ws = this.webSocketFactory(this.gatewayUrl);
    this.ws = ws;
    ws.addEventListener("message", (event) => this.onSocketMessage(event.data));
    ws.addEventListener("close", (event) => this.onSocketClose(event));
    ws.addEventListener("error", (event) => {
      console.error(`[discord] websocket error${event?.message ? `: ${event.message}` : ""}`);
    });
  }

  private detachSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws === null) return;
    try {
      ws.close(1000, "carapace stopping");
    } catch {
      // already closed — nothing to do
    }
  }

  private sendJson(payload: unknown): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch (error) {
      console.error(`[discord] websocket send failed: ${(error as Error).message}`);
    }
  }

  private sendIdentify(): void {
    if (this.token === null) return;
    this.sendJson({
      op: OP_IDENTIFY,
      d: {
        token: this.token,
        intents: INTENTS,
        properties: { os: process.platform, browser: "carapace", device: "carapace" },
      },
    });
  }

  private sendResume(): void {
    if (this.sessionId === null || this.seq === null) {
      this.sendIdentify();
      return;
    }
    this.sendJson({
      op: OP_RESUME,
      d: { token: this.token, session_id: this.sessionId, seq: this.seq },
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.awaitingHeartbeatAck = false;
    this.heartbeatTimer = setInterval(() => {
      // Missed ack = zombie link: drop the socket; the close handler resumes.
      if (this.awaitingHeartbeatAck) {
        this.ws?.close(4000, "heartbeat ack missing");
        return;
      }
      this.sendJson({ op: OP_HEARTBEAT, d: this.seq });
      this.awaitingHeartbeatAck = true;
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private onSocketMessage(data: unknown): void {
    if (typeof data !== "string" || data === "") return;
    let packet: GatewayPacket;
    try {
      packet = JSON.parse(data) as GatewayPacket;
    } catch {
      return;
    }
    if (typeof packet.op !== "number") return;
    if (typeof packet.s === "number") this.seq = packet.s;
    switch (packet.op) {
      case OP_HELLO: {
        const hello = (packet.d ?? {}) as { heartbeat_interval?: unknown };
        const interval =
          typeof hello.heartbeat_interval === "number" && hello.heartbeat_interval > 0
            ? hello.heartbeat_interval
            : DEFAULT_HEARTBEAT_MS;
        this.startHeartbeat(interval);
        // Fresh gateway connection: resume the remembered session, else identify.
        if (this.sessionId !== null && this.seq !== null) this.sendResume();
        else this.sendIdentify();
        return;
      }
      case OP_DISPATCH: {
        const payload = packet.d ?? {};
        if (packet.t === "READY") {
          const ready = payload as { session_id?: unknown; user?: { username?: unknown } };
          if (isText(ready.session_id)) this.sessionId = ready.session_id;
          const username = typeof ready.user?.username === "string" ? ready.user.username : "bot";
          console.log(`[discord] ready as ${username} (session ${this.sessionId ?? "?"})`);
          this.connected = true;
          this.backoffMs = BACKOFF_START_MS;
          this.settleStart();
          return;
        }
        if (packet.t === "RESUMED") {
          console.log("[discord] resumed");
          this.connected = true;
          this.backoffMs = BACKOFF_START_MS;
          this.settleStart();
          return;
        }
        if (packet.t === "MESSAGE_CREATE") {
          void this.routeMessage(payload as { author?: { id?: unknown; bot?: unknown }; channel_id?: unknown; content?: unknown; webhook_id?: unknown });
          return;
        }
        return; // other dispatch types are ignored for now
      }
      case OP_HEARTBEAT_ACK:
        this.awaitingHeartbeatAck = false;
        return;
      case OP_RECONNECT:
        // Server-requested reconnect: close cleanly; the close handler resumes.
        this.ws?.close(1000, "server requested reconnect");
        return;
      case OP_INVALID_SESSION: {
        if (packet.d !== true) {
          // Not resumable: forget the session so the next connection identifies fresh.
          this.sessionId = null;
          this.seq = null;
        }
        this.forcedDelayMs = HARD_RESTART_DELAY_MS;
        this.ws?.close(1000, "invalid session");
        return;
      }
      default:
        return;
    }
  }

  private onSocketClose(event: { code: number; reason: string; wasClean: boolean }): void {
    this.stopHeartbeat();
    this.ws = null;
    this.connected = false;
    if (event.code === CLOSE_AUTH_FAILED) {
      // 4004: the token is invalid — retrying can never succeed.
      this.fatalReason = "gateway rejected the bot token (close 4004)";
      this.sessionId = null;
      this.seq = null;
      this.settleStart(new Error(this.fatalReason));
      console.error(`[discord] ${this.fatalReason}`);
      return;
    }
    if (!this.running) {
      this.settleStart(new Error("discord gateway closed before ready (channel stopping)"));
      return;
    }
    const delay = this.forcedDelayMs ?? this.backoffMs;
    this.forcedDelayMs = null;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.scheduleReconnect(delay);
  }

  private async sendChunks(chatId: string, text: string): Promise<void> {
    const sender = this.sender;
    if (sender === null) throw new Error("discord channel is not started");
    for (const chunk of splitDiscordContent(text)) {
      await sender.postMessage(chatId, chunk);
    }
  }

  private async routeMessage(data: {
    author?: { id?: unknown; bot?: unknown };
    channel_id?: unknown;
    content?: unknown;
    webhook_id?: unknown;
  }): Promise<void> {
    const author = data.author;
    if (author === undefined || author.bot === true) return; // never echo bots, incl. ourselves
    if (data.webhook_id !== undefined) return; // webhook chatter is not a conversation
    const authorId = author?.id;
    const chatId = data.channel_id;
    const content = data.content;
    if (!isText(authorId) || !isText(chatId) || !isText(content)) return;
    if (content.trim() === "") return; // whitespace-only chatter
    const handler = this.messageHandler;
    if (handler === null) return;
    const message: ChannelMessage = {
      channel: "discord",
      senderId: authorId,
      chatId,
      text: content,
      receivedAt: Date.now(),
    };
    let reply: ChannelReply | void;
    try {
      reply = await handler(message);
    } catch (error) {
      if (error instanceof BusyTurnError) {
        await this.sendChunks(chatId, BUSY_NOTICE).catch(() => undefined);
        return;
      }
      console.error(`[discord] agent turn failed: ${(error as Error).message}`);
      await this.sendChunks(chatId, `⚠️ turn failed: ${(error as Error).message}`).catch(() => undefined);
      return;
    }
    if (reply !== undefined && reply.text !== "") {
      await this.sendChunks(chatId, reply.text).catch((error) => {
        console.error(`[discord] reply delivery failed: ${(error as Error).message}`);
      });
    }
  }
}