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
}

export interface TelegramChannelConfig {
  enabled: boolean;
  token: SecretValue;
  allowedSenders: string[];
}

export interface ApiChannelConfig {
  enabled: boolean;
}

export interface ChannelsConfig {
  telegram: TelegramChannelConfig;
  api: ApiChannelConfig;
}

export interface AgentConfig {
  /** Provider-agnostic model id; concrete providers land in M1. */
  model: string;
  systemPrompt: string;
  maxToolIterations: number;
}

export interface StorageConfig {
  path: string;
}

export interface CarapaceConfig {
  gateway: GatewayConfig;
  channels: ChannelsConfig;
  agent: AgentConfig;
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
    gateway: { host: "127.0.0.1", port: 8787 },
    channels: {
      telegram: { enabled: false, token: { env: "CARAPACE_TELEGRAM_TOKEN" }, allowedSenders: [] },
      api: { enabled: true },
    },
    agent: {
      model: "placeholder",
      systemPrompt: "You are Carapace, a helpful personal agent running on the owner's own hardware.",
      maxToolIterations: 8,
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

/** Validate an untrusted parsed JSON document against the Carapace schema. */
export function validateConfig(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const defaults = defaultConfig();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { config: defaults, errors: ["config root must be a JSON object"] };
  }
  const root = raw as Record<string, unknown>;
  const knownSections = new Set(["gateway", "channels", "agent", "storage"]);
  for (const key of Object.keys(root)) {
    if (!knownSections.has(key)) errors.push(`unknown top-level section "${key}"`);
  }

  const gatewayRaw = asObjectOrEmpty(root.gateway, "gateway", errors);
  const gateway: GatewayConfig = {
    host: readString(gatewayRaw, "host", "gateway", errors, defaults.gateway.host),
    port: readPort(gatewayRaw, "gateway", errors, defaults.gateway.port),
  };

  const channelsRaw = asObjectOrEmpty(root.channels, "channels", errors);
  const telegramRaw = asObjectOrEmpty(channelsRaw.telegram, "channels.telegram", errors);
  const apiRaw = asObjectOrEmpty(channelsRaw.api, "channels.api", errors);
  const channels: ChannelsConfig = {
    telegram: {
      enabled: readBoolean(telegramRaw, "enabled", "channels.telegram", errors, defaults.channels.telegram.enabled),
      token: readSecretValue(telegramRaw, "token", "channels.telegram", errors, defaults.channels.telegram.token),
      allowedSenders: readStringArray(
        telegramRaw,
        "allowedSenders",
        "channels.telegram",
        errors,
        defaults.channels.telegram.allowedSenders,
      ),
    },
    api: { enabled: readBoolean(apiRaw, "enabled", "channels.api", errors, defaults.channels.api.enabled) },
  };

  const agentRaw = asObjectOrEmpty(root.agent, "agent", errors);
  const agent: AgentConfig = {
    model: readString(agentRaw, "model", "agent", errors, defaults.agent.model),
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
  };

  const storageRaw = asObjectOrEmpty(root.storage, "storage", errors);
  const storage: StorageConfig = {
    path: expandTilde(readString(storageRaw, "path", "storage", errors, defaults.storage.path)),
  };

  return { config: { gateway, channels, agent, storage }, errors };
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

  const model = env("AGENT_MODEL");
  if (model !== undefined) config.agent.model = model;

  const storagePath = env("STORAGE_PATH");
  if (storagePath !== undefined) config.storage.path = expandTilde(storagePath);

  const telegramEnabled = env("TELEGRAM_ENABLED");
  if (telegramEnabled !== undefined) {
    const flag = parseEnvBoolean(`${ENV_PREFIX}TELEGRAM_ENABLED`, telegramEnabled, warnings);
    if (flag !== null) config.channels.telegram.enabled = flag;
  }

  const telegramToken = env("TELEGRAM_TOKEN");
  if (telegramToken !== undefined) config.channels.telegram.token = telegramToken;

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