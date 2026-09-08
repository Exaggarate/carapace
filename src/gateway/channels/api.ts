// Raw HTTP channel.
// Request contract (frozen at M0 so clients can build against it):
//   POST /api/v1/messages  body: { "senderId": string, "text": string, "chatId"?: string }
//   GET  /api/v1/channels  → channel status listing
//   GET  /api/v1/sessions  → session listing (M2)
// Since M1 the message handler runs the real agent loop and replies in-band.
// Since M2 the message and session endpoints require bearer auth when
// gateway.apiToken is set.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { respondJson, RouteTable } from "../server.js";
import { resolveSecret, type CarapaceConfig } from "../../config.js";
import { BusyTurnError, type ChannelAdapter, type MessageHandler, type SessionDirectory } from "./types.js";

type BodyRead = { ok: true; value: unknown } | { ok: false; status: number; error: string };

const MAX_BODY_BYTES = 1_048_576;

/**
 * Bearer-token check for API-channel endpoints. When gateway.apiToken resolves,
 * requests must carry `Authorization: Bearer <token>` (constant-time compare).
 * When no token is configured the channel runs open — bind it to localhost in
 * that case; `carapace doctor` names the mode.
 */
export function requestAuthorized(config: CarapaceConfig, request: IncomingMessage): boolean {
  const expected = resolveSecret(config.gateway.apiToken);
  if (expected === null) return true;
  const header = request.headers.authorization;
  const match = /^Bearer (.+)$/s.exec(typeof header === "string" ? header : "");
  if (match === null) return false;
  const encoder = new TextEncoder();
  const provided = encoder.encode(match[1]);
  const required = encoder.encode(expected);
  if (provided.byteLength === 0 || provided.byteLength !== required.byteLength) return false;
  return timingSafeEqual(provided, required);
}

function respondUnauthorized(response: ServerResponse): void {
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": 'Bearer realm="carapace-api"',
  });
  response.end(JSON.stringify({ error: "unauthorized" }));
}

async function readJsonBody(request: IncomingMessage): Promise<BodyRead> {
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  return await new Promise<BodyRead>((resolve) => {
    request.on("data", (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        resolve({ ok: false, status: 413, error: "payload_too_large" });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const merged = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        resolve({ ok: true, value: JSON.parse(decoder.decode(merged)) as unknown });
      } catch {
        resolve({ ok: false, status: 400, error: "invalid_json" });
      }
    });
    request.on("error", () => resolve({ ok: false, status: 400, error: "request_stream_error" }));
  });
}

export class ApiChannel implements ChannelAdapter {
  readonly name = "api";
  /** The HTTP channel replies in-band; it cannot receive proactive pushes (#27445). */
  readonly pushCapable = false;

  private messageHandler: MessageHandler | null = null;

  constructor(
    private readonly config: CarapaceConfig,
    private readonly sessions?: SessionDirectory,
  ) {}

  isConfigured(): boolean {
    return this.config.channels.api.enabled;
  }

  describe(): string {
    const auth = resolveSecret(this.config.gateway.apiToken) === null ? "open (no gateway.apiToken)" : "bearer-token";
    return `enabled=${this.config.channels.api.enabled}, endpoint=POST /api/v1/messages (agent loop live), GET /api/v1/sessions, auth=${auth}`;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("api channel is disabled in config (channels.api.enabled=false)");
    }
  }

  async stop(): Promise<void> {}

  async send(_chatId: string, _text: string): Promise<void> {
    // The HTTP channel replies in-band (HTTP response), so push-send is a no-op.
  }

  mountRoutes(routes: RouteTable): void {
    routes.add("POST", "/api/v1/messages", async (request, response) => {
      if (!requestAuthorized(this.config, request)) {
        respondUnauthorized(response);
        return;
      }
      if (!this.isConfigured()) {
        respondJson(response, 503, { error: "channel_disabled" });
        return;
      }
      const body = await readJsonBody(request);
      if (!body.ok) {
        respondJson(response, body.status, { error: body.error });
        return;
      }
      const payload = body.value as Record<string, unknown>;
      const senderIdRaw = payload?.senderId;
      const textRaw = payload?.text;
      const senderId = typeof senderIdRaw === "string" ? senderIdRaw : null;
      const text = typeof textRaw === "string" ? textRaw : null;
      if (senderId === null || text === null) {
        respondJson(response, 400, {
          error: "invalid_body",
          expected: { senderId: "string", text: "string", chatId: "string (optional)" },
        });
        return;
      }
      if (this.messageHandler === null) {
        respondJson(response, 503, { error: "handler_unavailable" });
        return;
      }
      const chatIdRaw = payload?.chatId;
      const chatId = typeof chatIdRaw === "string" && chatIdRaw.trim() !== "" ? chatIdRaw : senderId;
      try {
        const reply = await this.messageHandler({
          channel: "api",
          senderId,
          chatId,
          text,
          receivedAt: Date.now(),
        });
        respondJson(response, 200, { reply: reply?.text ?? "", channel: "api", chatId });
      } catch (error) {
        if (error instanceof BusyTurnError) {
          respondJson(response, 429, { error: "busy", queueLimit: error.queueLimit });
          return;
        }
        respondJson(response, 500, { error: "agent_turn_failed", detail: (error as Error).message });
      }
    });
    routes.add("GET", "/api/v1/sessions", (request, response) => {
      if (!requestAuthorized(this.config, request)) {
        respondUnauthorized(response);
        return;
      }
      const directory = this.sessions;
      if (directory === undefined) {
        respondJson(response, 503, { error: "sessions_unavailable" });
        return;
      }
      const sessions = directory.list(50).map((session) => ({
        id: session.id,
        channel: session.channel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: directory.countMessages(session.id),
      }));
      respondJson(response, 200, { sessions });
    });
    routes.add("GET", "/api/v1/channels", (_request, response) => {
      respondJson(response, 200, {
        channels: [
          { name: "api", enabled: this.config.channels.api.enabled },
          { name: "telegram", enabled: this.config.channels.telegram.enabled },
        ],
      });
    });
  }
}