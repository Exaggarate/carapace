// Carapace configuration: ~/.carapace/config.json + CARAPACE_* env overrides.
// M0 scope: typed schema, defaults-on-first-run, env overrides, SecretRef resolution.
// Design rule: secrets live OUTSIDE config files. Plain strings are accepted for
// local tinkering, but SecretRefs ({ "env": "NAME" } or { "file": "/path" }) are the
// recommended shape — resolution happens at runtime and values are never logged here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ENV_PREFIX = "CARAPACE_";

/** A pointer to a secret stored outside the config file. */
export type SecretRef = { env: string } | { file: string };

/** Either a literal value (discouraged for secrets) or a SecretRef. */
export type SecretValue = string | SecretRef;

export interface GatewayConfig {
  host: string;
  port: number;
  /**
   * Bearer token required on API-channel endpoints. Accepts a SecretRef; resolved
   * at runtime, never logged. When no token resolves, the API channel runs open
   * (bind it to localhost in that case) and doctor flags it.
   */
  apiToken: SecretValue;
  /**
   * Max messages that may wait in a chat's queue while a turn is in flight
   * (1–100). Further messages are refused with a busy notice (API: HTTP 429).
   */
  busyQueueLimit: number;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  /** Bot token from BotFather. Accepts a SecretRef; resolved at runtime, never logged. */
  botToken: SecretValue;
  allowedSenders: string[];
  /** Where inbound photos/documents/voice are saved (tilde allowed). */
  mediaDir: string;
  /**
   * Telegram Business support (#20786): handle business_message/business_connection
   * updates and reply on behalf of the connected business account. Default true —
   * the Bot API only delivers those updates once an owner connects the bot via
   * Telegram Business settings, so the toggle defaults on.
   */
  business: boolean;
}

export interface ApiChannelConfig {
  enabled: boolean;
}

export interface ChannelsConfig {
  telegram: TelegramChannelConfig;
  api: ApiChannelConfig;
}

/** Where turn-completion notices route instead of the origin chat (#27445). */
export interface AnnounceTargetConfig {
  /** Channel adapter name (e.g. "telegram"). */
  channel: string;
  /** Destination chat id on that channel. */
  chatId: string;
}

/** One per-sender routing entry (#81271): match a sender/chat, override routing. */
export interface SenderRouteConfig {
  /** Exact sender id or chat id this route matches. */
  match: string;
  /** Restrict the route to one channel (e.g. "telegram" or "api"); absent = any. */
  channel?: string;
  /** Tool allowlist for matching senders (registry names); absent = all tools. */
  allowTools?: string[];
  /** Model override for matching senders; absent = llm.model. */
  model?: string;
}

export interface AgentConfig {
  systemPrompt: string;
  maxToolIterations: number;
  /**
   * Completion routing (#27445): when set and the message arrives from a DIFFERENT
n   * chat, the full reply is delivered to this channel:chatId and the origin chat
   * receives a short routing notice instead. Null = reply to the origin chat.
   */
  announceTarget: AnnounceTargetConfig | null;
}

/** OpenAI-compatible chat-completions endpoint (OpenAI, Ollama, vLLM, OpenRouter, …). */
export interface LlmConfig {
  /** e.g. https://api.openai.com/v1 — the provider appends /chat/completions. */
  baseURL: string;
  /** Bearer token. Accepts a SecretRef; resolved at runtime, never logged. */
  apiKey: SecretValue;
  model: string;
  /** Per-request HTTP timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Wall-clock budget for one whole agent turn — every LLM call and tool run in the
   * loop (1000–3600000). A turn past its budget aborts cleanly with a user-visible
   * error instead of hanging forever (#68596).
   */
  turnTimeoutMs: number;
  /**
   * Stall watchdog in seconds (1–3600): a single provider call that produces no
   * completion within this window is aborted and the turn fails with a readable
   * error (#68596).
   */
  watchdogTimeoutSec: number;
}

export interface ToolsConfig {
  /** Filesystem roots the files tool may touch; also bounds the exec tool's cwd. */
  allowedRoots: string[];
  exec: {
    timeoutMs: number;
    /** Substrings that make the exec tool refuse a command (case-insensitive). */
    denylist: string[];
  };
}

export interface StorageConfig {
  path: string;
}

export interface CarapaceConfig {
  gateway: GatewayConfig;
  llm: LlmConfig;
  channels: ChannelsConfig;
  agent: AgentConfig;
  tools: ToolsConfig;
  /** Per-sender routing table (#81271): sender/chat → tool allowlist + model override. */
  senders: SenderRouteConfig[];
  storage: StorageConfig;
}

export interface LoadedConfig {
  config: CarapaceConfig;
  configPath: string;
  createdDefaults: boolean;
  warnings: string[];
}

/** Thrown when config.json exists but does not satisfy the schema. */
export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`invalid carapace config:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function expandTilde(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

/** Root directory for config and state. Env override: CARAPACE_HOME. */
export function carapaceHome(): string {
  const override = process.env[`${ENV_PREFIX}HOME`];
  if (override !== undefined && override.trim() !== "") return expandTilde(override);
  return join(homedir(), ".carapace");
}

export function configFilePath(dir: string = carapaceHome()): string {
  return join(dir, "config.json");
}

export function isSecretRef(value: unknown): value is SecretRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length !== 1) return false;
  const [kind, target] = entries[0] as [string, unknown];
  if (kind !== "env" && kind !== "file") return false;
  return typeof target === "string" && target.length > 0;
}

/**
 * Resolve a SecretValue at runtime. Returns null when the secret cannot be found —
 * callers decide whether that is fatal. Values are never logged by this module.
 */
export function resolveSecret(value: SecretValue): string | null {
  // Defensive: hand-built configs (tests) may omit the key entirely.
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if ("env" in value) {
    const fromEnv = process.env[value.env];
    return fromEnv !== undefined && fromEnv.trim() !== "" ? fromEnv : null;
  }
  const filePath = expandTilde(value.file);
  if (!existsSync(filePath)) return null;
  const contents = readFileSync(filePath, "utf8").trim();
  return contents === "" ? null : contents;
}

/** Human-safe description of where a secret comes from (never the secret itself). */
export function describeSecretValue(value: SecretValue): string {
  if (typeof value === "string") return "inline string in config";
  if ("env" in value) return `env:${value.env}`;
  return `file:${expandTilde(value.file)}`;
}

export function defaultConfig(dir: string = carapaceHome()): CarapaceConfig {
  return {
    gateway: {
      host: "127.0.0.1",
      // Default 8899: 8787 is frequently occupied by unrelated services on shared
      // hosts. Override via config or CARAPACE_GATEWAY_PORT.
      port: 8899,
      apiToken: { env: "CARAPACE_API_TOKEN" },
      busyQueueLimit: 10,
    },
    llm: {
      baseURL: "https://api.openai.com/v1",
      apiKey: { env: "CARAPACE_LLM_API_KEY" },
      model: "gpt-4o-mini",
      timeoutMs: 120_000,
      turnTimeoutMs: 600_000,
      watchdogTimeoutSec: 300,
    },
    channels: {
      telegram: {
        enabled: false,
        botToken: { env: "CARAPACE_TELEGRAM_TOKEN" },
        allowedSenders: [],
        mediaDir: join(dir, "workspace", "media"),
        business: true,
      },
      api: { enabled: true },
    },
    agent: {
      systemPrompt: "You are Carapace, a helpful personal agent running on the owner's own hardware.",
      maxToolIterations: 12,
      announceTarget: null,
    },
    senders: [],
    tools: {
      allowedRoots: [join(dir, "workspace")],
      exec: {
        timeoutMs: 30_000,
        denylist: ["rm -rf /", "mkfs", ":(){ :|:& };:", "dd if=/dev/", "shutdown", "reboot", "halt"],
      },
    },
    storage: { path: join(dir, "carapace.db") },
  };
}

interface ValidationResult {
  config: CarapaceConfig;
  errors: string[];
}

function asObjectOrEmpty(value: unknown, label: string, errors: string[]): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  errors.push(`${label} must be a JSON object`);
  return {};
}

function readString(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  fallback: string,
): string {
  const raw = obj[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || raw.trim() === "") {
    errors.push(`${label}.${key} must be a non-empty string`);
    return fallback;
  }
  return raw;
}

function readBoolean(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  fallback: boolean,
): boolean {
  const raw = obj[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    errors.push(`${label}.${key} must be true or false`);
    return fallback;
  }
  return raw;
}

function readPort(obj: Record<string, unknown>, label: string, errors: string[], fallback: number): number {
  const raw = obj.port;
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 65535) {
    errors.push(`${label}.port must be an integer between 1 and 65535`);
    return fallback;
  }
  return raw;
}

function readBoundedInt(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = obj[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
    errors.push(`${label}.${key} must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return raw;
}

function readSecretValue(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  fallback: SecretValue,
): SecretValue {
  const raw = obj[key];
  if (raw === undefined) return fallback;
  if (typeof raw === "string") return raw;
  if (isSecretRef(raw)) return raw;
  errors.push(`${label}.${key} must be a string or a SecretRef ({ "env": "NAME" } or { "file": "/path" })`);
  return fallback;
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  fallback: string[],
): string[] {
  const raw = obj[key];
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    errors.push(`${label}.${key} must be an array of strings`);
    return fallback;
  }
  return raw as string[];
}

function readAnnounceTarget(
  obj: Record<string, unknown>,
  errors: string[],
  fallback: AnnounceTargetConfig | null,
): AnnounceTargetConfig | null {
  const raw = obj.announceTarget;
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push('agent.announceTarget must be null or an object with "channel" and "chatId" strings');
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const { channel, chatId } = record;
  if (typeof channel !== "string" || channel.trim() === "" || typeof chatId !== "string" || chatId.trim() === "") {
    errors.push('agent.announceTarget must be null or an object with "channel" and "chatId" strings');
    return fallback;
  }
  return { channel, chatId };
}

/** Validate an untrusted parsed JSON document against the Carapace schema. */
export function validateConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const defaults = defaultConfig();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: defaults, errors: ["config root must be a JSON object"] };
  }
  const root = raw as Record<string, unknown>;
  const knownSections = new Set(["gateway", "llm", "channels", "agent", "tools", "storage", "senders"]);
  for (const key of Object.keys(root)) {
    if (!knownSections.has(key)) errors.push(`unknown top-level section "${key}"`);
  }

  const gatewayRaw = asObjectOrEmpty(root.gateway, "gateway", errors);
  const gateway: GatewayConfig = {
    host: readString(gatewayRaw, "host", "gateway", errors, defaults.gateway.host),
    port: readPort(gatewayRaw, "gateway", errors, defaults.gateway.port),
    apiToken: readSecretValue(gatewayRaw, "apiToken", "gateway", errors, defaults.gateway.apiToken),
    busyQueueLimit: readBoundedInt(
      gatewayRaw,
      "busyQueueLimit",
      "gateway",
      errors,
      defaults.gateway.busyQueueLimit,
      1,
      100,
    ),
  };

  const channelsRaw = asObjectOrEmpty(root.channels, "channels", errors);
  const telegramRaw = asObjectOrEmpty(channelsRaw.telegram, "channels.telegram", errors);
  const apiRaw = asObjectOrEmpty(channelsRaw.api, "channels.api", errors);
  // M0 configs used `token`; keep accepting it as a fallback alias for botToken.
  const botToken = readSecretValue(
    telegramRaw,
    "botToken",
    "channels.telegram",
    errors,
    readSecretValue(telegramRaw, "token", "channels.telegram", errors, defaults.channels.telegram.botToken),
  );
  const channels: ChannelsConfig = {
    telegram: {
      enabled: readBoolean(telegramRaw, "enabled", "channels.telegram", errors, defaults.channels.telegram.enabled),
      botToken,
      allowedSenders: readStringArray(
        telegramRaw,
        "allowedSenders",
        "channels.telegram",
        errors,
        defaults.channels.telegram.allowedSenders,
      ),
      mediaDir: expandTilde(
        readString(telegramRaw, "mediaDir", "channels.telegram", errors, defaults.channels.telegram.mediaDir),
      ),
      business: readBoolean(telegramRaw, "business", "channels.telegram", errors, defaults.channels.telegram.business),
    },
    api: { enabled: readBoolean(apiRaw, "enabled", "channels.api", errors, defaults.channels.api.enabled) },
  };

  const llmRaw = asObjectOrEmpty(root.llm, "llm", errors);
  const llm: LlmConfig = {
    baseURL: readString(llmRaw, "baseURL", "llm", errors, defaults.llm.baseURL),
    apiKey: readSecretValue(llmRaw, "apiKey", "llm", errors, defaults.llm.apiKey),
    model: readString(llmRaw, "model", "llm", errors, defaults.llm.model),
    timeoutMs: readBoundedInt(llmRaw, "timeoutMs", "llm", errors, defaults.llm.timeoutMs, 5_000, 600_000),
    turnTimeoutMs: readBoundedInt(
      llmRaw,
      "turnTimeoutMs",
      "llm",
      errors,
      defaults.llm.turnTimeoutMs,
      1_000,
      3_600_000,
    ),
    watchdogTimeoutSec: readBoundedInt(
      llmRaw,
      "watchdogTimeoutSec",
      "llm",
      errors,
      defaults.llm.watchdogTimeoutSec,
      1,
      3_600,
    ),
  };

  const toolsRaw = asObjectOrEmpty(root.tools, "tools", errors);
  const execRaw = asObjectOrEmpty(toolsRaw.exec, "tools.exec", errors);
  const tools: ToolsConfig = {
    allowedRoots: readStringArray(toolsRaw, "allowedRoots", "tools", errors, defaults.tools.allowedRoots).map(
      expandTilde,
    ),
    exec: {
      timeoutMs: readBoundedInt(
        execRaw,
        "timeoutMs",
        "tools.exec",
        errors,
        defaults.tools.exec.timeoutMs,
        1_000,
        300_000,
      ),
      denylist: readStringArray(execRaw, "denylist", "tools.exec", errors, defaults.tools.exec.denylist),
    },
  };

  const agentRaw = asObjectOrEmpty(root.agent, "agent", errors);
  const agent: AgentConfig = {
    systemPrompt: readString(agentRaw, "systemPrompt", "agent", errors, defaults.agent.systemPrompt),
    maxToolIterations: readBoundedInt(
      agentRaw,
      "maxToolIterations",
      "agent",
      errors,
      defaults.agent.maxToolIterations,
      1,
      64,
    ),
    announceTarget: readAnnounceTarget(agentRaw, errors, defaults.agent.announceTarget),
  };

  // Per-sender routing table (#81271). Invalid entries are dropped with an error —
  // a broken route must never silently widen or narrow someone's access.
  const senders: SenderRouteConfig[] = [];
  if (root.senders !== undefined) {
    if (!Array.isArray(root.senders)) {
      errors.push("senders must be an array of routing entries");
    } else {
      const seenRoutes = new Set<string>();
      root.senders.forEach((entry, index) => {
        const label = `senders[${index}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          errors.push(`${label} must be an object`);
          return;
        }
        const record = entry as Record<string, unknown>;
        const match = record.match;
        if (typeof match !== "string" || match.trim() === "") {
          errors.push(`${label}.match must be a non-empty string`);
          return;
        }
        let channel: string | undefined;
        if (record.channel !== undefined) {
          if (typeof record.channel !== "string" || record.channel.trim() === "") {
            errors.push(`${label}.channel must be a non-empty string`);
            return;
          }
          channel = record.channel;
        }
        let allowTools: string[] | undefined;
        if (record.allowTools !== undefined) {
          const raw = record.allowTools;
          if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || item.trim() === "")) {
            errors.push(`${label}.allowTools must be an array of non-empty tool names`);
            return;
          }
          allowTools = raw as string[];
        }
        let model: string | undefined;
        if (record.model !== undefined) {
          if (typeof record.model !== "string" || record.model.trim() === "") {
            errors.push(`${label}.model must be a non-empty string`);
            return;
          }
          model = record.model;
        }
        if (allowTools === undefined && model === undefined) {
          errors.push(`${label} must set allowTools, model, or both`);
          return;
        }
        const routeKey = `${channel ?? "*"}:${match}`;
        if (seenRoutes.has(routeKey)) {
          errors.push(`${label}: duplicate sender route for ${routeKey}`);
          return;
        }
        seenRoutes.add(routeKey);
        const route: SenderRouteConfig = { match };
        if (channel !== undefined) route.channel = channel;
        if (allowTools !== undefined) route.allowTools = allowTools;
        if (model !== undefined) route.model = model;
        senders.push(route);
      });
    }
  }

  const storageRaw = asObjectOrEmpty(root.storage, "storage", errors);
  const storage: StorageConfig = {
    path: expandTilde(readString(storageRaw, "path", "storage", errors, defaults.storage.path)),
  };

  return { config: { gateway, llm, channels, agent, tools, senders, storage }, errors };
}

function parseEnvBoolean(name: string, raw: string, warnings: string[]): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  warnings.push(`ignoring ${name}="${raw}" — expected true or false`);
  return null;
}

function applyEnvOverrides(config: CarapaceConfig, warnings: string[]): void {
  const env = (suffix: string): string | undefined => {
    const value = process.env[`${ENV_PREFIX}${suffix}`];
    return value !== undefined && value.trim() !== "" ? value : undefined;
  };

  const host = env("GATEWAY_HOST");
  if (host !== undefined) config.gateway.host = host;

  const portText = env("GATEWAY_PORT");
  if (portText !== undefined) {
    const port = Number.parseInt(portText, 10);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) config.gateway.port = port;
    else warnings.push(`ignoring ${ENV_PREFIX}GATEWAY_PORT="${portText}" — not an integer between 1 and 65535`);
  }

  const apiToken = env("API_TOKEN");
  if (apiToken !== undefined) config.gateway.apiToken = apiToken;

  const busyQueueLimit = env("BUSY_QUEUE_LIMIT");
  if (busyQueueLimit !== undefined) {
    const parsed = Number.parseInt(busyQueueLimit, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 100) config.gateway.busyQueueLimit = parsed;
    else warnings.push(`ignoring ${ENV_PREFIX}BUSY_QUEUE_LIMIT="${busyQueueLimit}" — not an integer between 1 and 100`);
  }

  const llmBaseUrl = env("LLM_BASE_URL");
  if (llmBaseUrl !== undefined) config.llm.baseURL = llmBaseUrl;

  const llmApiKey = env("LLM_API_KEY");
  if (llmApiKey !== undefined) config.llm.apiKey = llmApiKey;

  const llmModel = env("LLM_MODEL");
  if (llmModel !== undefined) config.llm.model = llmModel;

  const turnTimeoutMs = env("TURN_TIMEOUT_MS");
  if (turnTimeoutMs !== undefined) {
    const parsed = Number.parseInt(turnTimeoutMs, 10);
    if (Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 3_600_000) config.llm.turnTimeoutMs = parsed;
    else {
      warnings.push(
        `ignoring ${ENV_PREFIX}TURN_TIMEOUT_MS="${turnTimeoutMs}" — not an integer between 1000 and 3600000`,
      );
    }
  }

  const watchdogTimeoutSec = env("WATCHDOG_TIMEOUT_SEC");
  if (watchdogTimeoutSec !== undefined) {
    const parsed = Number.parseInt(watchdogTimeoutSec, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 3_600) config.llm.watchdogTimeoutSec = parsed;
    else {
      warnings.push(
        `ignoring ${ENV_PREFIX}WATCHDOG_TIMEOUT_SEC="${watchdogTimeoutSec}" — not an integer between 1 and 3600`,
      );
    }
  }

  // CARAPACE_ANNOUNCE_TARGET="telegram:-100123456" — channel:chatId, first colon splits.
  const announceTarget = env("ANNOUNCE_TARGET");
  if (announceTarget !== undefined) {
    const split = announceTarget.indexOf(":");
    if (split > 0 && split < announceTarget.length - 1) {
      config.agent.announceTarget = {
        channel: announceTarget.slice(0, split),
        chatId: announceTarget.slice(split + 1),
      };
    } else {
      warnings.push(
        `ignoring ${ENV_PREFIX}ANNOUNCE_TARGET="${announceTarget}" — expected channel:chatId (e.g. telegram:-100123456)`,
      );
    }
  }

  const storagePath = env("STORAGE_PATH");
  if (storagePath !== undefined) config.storage.path = expandTilde(storagePath);

  const telegramEnabled = env("TELEGRAM_ENABLED");
  if (telegramEnabled !== undefined) {
    const flag = parseEnvBoolean(`${ENV_PREFIX}TELEGRAM_ENABLED`, telegramEnabled, warnings);
    if (flag !== null) config.channels.telegram.enabled = flag;
  }

  const telegramToken = env("TELEGRAM_TOKEN");
  if (telegramToken !== undefined) config.channels.telegram.botToken = telegramToken;

  const mediaDir = env("MEDIA_DIR");
  if (mediaDir !== undefined) config.channels.telegram.mediaDir = expandTilde(mediaDir);

  const apiEnabled = env("API_ENABLED");
  if (apiEnabled !== undefined) {
    const flag = parseEnvBoolean(`${ENV_PREFIX}API_ENABLED`, apiEnabled, warnings);
    if (flag !== null) config.channels.api.enabled = flag;
  }
}

/**
 * Load the effective config. Creates ~/.carapace/config.json with defaults on first
 * run, validates it, then applies CARAPACE_* env overrides on top. Throws ConfigError
 * when the file exists but is invalid.
 */
export function loadConfig(): LoadedConfig {
  const dir = carapaceHome();
  mkdirSync(dir, { recursive: true });
  const file = configFilePath(dir);
  let raw: unknown;
  let createdDefaults = false;
  if (!existsSync(file)) {
    raw = defaultConfig(dir);
    writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    createdDefaults = true;
  } else {
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      throw new ConfigError([`config.json is not valid JSON: ${(error as Error).message}`]);
    }
  }
  const { config, errors } = validateConfig(raw);
  if (errors.length > 0) throw new ConfigError(errors);
  const warnings: string[] = [];
  applyEnvOverrides(config, warnings);
  return { config, configPath: file, createdDefaults, warnings };
}

/**
 * First-match per-sender routing (#81271): a route applies when its channel (when
 * set) equals the message's channel and its match equals the sender id or chat id.
 * Earlier entries win; duplicates are rejected at validation time.
 */
export function resolveSenderRoute(
  config: CarapaceConfig,
  message: { channel: string; senderId: string; chatId: string },
): SenderRouteConfig | null {
  // Hand-built configs (tests) may omit the senders table entirely.
  for (const route of config.senders ?? []) {
    if (route.channel !== undefined && route.channel !== message.channel) continue;
    if (route.match === message.senderId || route.match === message.chatId) return route;
  }
  return null;
}