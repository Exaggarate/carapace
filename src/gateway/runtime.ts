// Gateway runtime assembly: config → provider + tools + session store + channels.
// Shared by the CLI, tests, and future entry points so there is exactly one wiring.

import { join } from "node:path";
import {
  carapaceHome,
  describeSecretValue,
  resolveSecret,
  resolveSenderRoute,
  type CarapaceConfig,
  type LlmProviderKind,
  type SecretValue,
} from "../config.js";
import { runAgentTurn, type AgentRuntime, type ChatProvider } from "../core/agent.js";
import { MemoryStore } from "../core/memory.js";
import { AnthropicProvider } from "../core/llm/providers/anthropic.js";
import { FallbackProvider } from "../core/llm/providers/fallback.js";
import { OllamaLocalProvider } from "../core/llm/providers/ollama.js";
import { OpenAiProvider } from "../core/llm/providers/openai.js";
import type { SkillRegistry } from "../core/skills.js";
import { createBuiltinTools } from "../core/tools/builtins/index.js";
import { SessionStore } from "../core/session.js";
import { CarapaceStore } from "../storage/sqlite.js";
import { ApiChannel } from "./channels/api.js";
import { DiscordChannel, type DiscordChannelOptions } from "./channels/discord.js";
import { TelegramChannel, type OffsetPersistence, type TelegramChannelOptions } from "./channels/telegram.js";
import { BusyTurnError, type ChannelAdapter, type ChannelMessage, type ChannelReply, type MessageHandler } from "./channels/types.js";
import { mountDashboardRoutes } from "./dashboard.js";
import { mountPluginRoutes, scanPlugins } from "./plugins.js";
import { RouteTable } from "./server.js";
import { Scheduler } from "./scheduler.js";

export interface RuntimeOptions {
  config: CarapaceConfig;
  /** Test seam: inject a provider instead of building the OpenAI-compatible one. */
  provider?: ChatProvider;
  /** Test seam: inject a store (e.g. :memory:) instead of opening config.storage.path. */
  store?: CarapaceStore;
  /** Test seam: options forwarded to the Telegram adapter (e.g. fetchImpl). */
  telegramOptions?: TelegramChannelOptions;
  /** Test seam: options forwarded to the Discord adapter (e.g. fetchImpl/webSocketFactory). */
  discordOptions?: DiscordChannelOptions;
  /** Test seam: provider factory for per-sender model overrides (#81271). */
  providerForModel?: (model: string) => ChatProvider;
  /** Skills registry (M7): its index is appended to every turn's system prompt. */
  skills?: SkillRegistry;
  /** Memory store (M9); defaults to ~/.carapace/workspace (memory/ + MEMORY.md). */
  memory?: MemoryStore;
}

/** A message waiting for its chat's turn, with the promise it must settle. */
interface PendingTurn {
  message: ChannelMessage;
  resolve: (reply: ChannelReply) => void;
  reject: (error: unknown) => void;
}

export interface GatewayRuntime {
  agent: AgentRuntime;
  channels: ChannelAdapter[];
  routes: RouteTable;
  /** Per-chat serialized agent turns with a bounded busy queue (gateway.busyQueueLimit). */
  handleMessage: MessageHandler;
  /** Resolves true once no chat has a running or queued turn; false after timeoutMs. */
  waitUntilIdle(timeoutMs?: number): Promise<boolean>;
  /** Close the underlying store (idempotent enough for tests and shutdown). */
  close(): void;
  /** Automation scheduler (M8): built here, started/stopped by the CLI. Undefined when disabled. */
  scheduler?: Scheduler;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

/** One fully-resolved provider entry (primary or fallback) before instantiation. */
interface ProviderEntrySpec {
  kind: LlmProviderKind;
  model: string;
  baseURL: string;
  /** null = the provider needs no credential (local Ollama). */
  apiKey: SecretValue | null;
  maxTokens?: number;
}

/** Resolve the serving chain: the primary provider first, then llm.fallbacks[] in order. */
function providerEntriesFromConfig(config: CarapaceConfig, model?: string): ProviderEntrySpec[] {
  const kind = config.llm.provider ?? "openai";
  const entries: ProviderEntrySpec[] = [];
  if (kind === "anthropic") {
    const anthropic = config.llm.anthropic;
    entries.push({
      kind,
      model: model ?? anthropic?.model ?? config.llm.model,
      baseURL: anthropic?.baseURL ?? ANTHROPIC_DEFAULT_BASE_URL,
      apiKey: anthropic?.apiKey ?? { env: "CARAPACE_ANTHROPIC_API_KEY" },
      maxTokens: anthropic?.maxTokens,
    });
  } else if (kind === "ollama") {
    const ollama = config.llm.ollama;
    entries.push({
      kind,
      model: model ?? ollama?.model ?? config.llm.model,
      baseURL: ollama?.baseURL ?? OLLAMA_DEFAULT_BASE_URL,
      apiKey: ollama?.apiKey ?? "ollama",
    });
  } else {
    // Default and backward compatibility: top-level baseURL/apiKey/model are the
    // OpenAI-compatible provider.
    entries.push({
      kind: "openai",
      model: model ?? config.llm.model,
      baseURL: config.llm.baseURL,
      apiKey: config.llm.apiKey,
    });
  }
  for (const fallback of config.llm.fallbacks ?? []) {
    entries.push({
      kind: fallback.provider,
      model: fallback.model,
      baseURL:
        fallback.baseURL ??
        (fallback.provider === "anthropic"
          ? ANTHROPIC_DEFAULT_BASE_URL
          : fallback.provider === "ollama"
            ? OLLAMA_DEFAULT_BASE_URL
            : OPENAI_DEFAULT_BASE_URL),
      apiKey: fallback.apiKey ?? (fallback.provider === "ollama" ? "ollama" : null),
      maxTokens: fallback.maxTokens,
    });
  }
  return entries;
}

function providerFromSpec(spec: ProviderEntrySpec, timeoutMs: number): ChatProvider {
  const apiKey = spec.apiKey === null ? "" : (resolveSecret(spec.apiKey) ?? "");
  switch (spec.kind) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey,
        model: spec.model,
        baseURL: spec.baseURL,
        maxTokens: spec.maxTokens,
        timeoutMs,
      });
    case "ollama":
      return new OllamaLocalProvider({
        baseURL: spec.baseURL,
        apiKey: apiKey === "" ? undefined : apiKey,
        model: spec.model,
        timeoutMs,
      });
    default:
      return new OpenAiProvider({ baseURL: spec.baseURL, apiKey, model: spec.model, timeoutMs });
  }
}

export function buildProviderChain(config: CarapaceConfig, model?: string): ChatProvider[] {
  const timeoutMs = config.llm.timeoutMs;
  return providerEntriesFromConfig(config, model).map((spec) => providerFromSpec(spec, timeoutMs));
}

/**
 * The provider (chain) for agent turns: the primary provider per llm.provider, or a
 * FallbackProvider when llm.fallbacks[] is configured. Per-sender model overrides
 * (#81271) swap the model on the primary provider kind; fallback entries keep
 * their own models.
 */
export function createProviderFromConfig(config: CarapaceConfig, model?: string): ChatProvider {
  const chain = buildProviderChain(config, model);
  const [primary] = chain;
  if (chain.length === 1 && primary !== undefined) return primary;
  return new FallbackProvider(chain);
}

/** Human-safe description of one chain entry (for `carapace models` and doctor). */
export interface ProviderChainEntry {
  kind: LlmProviderKind;
  model: string;
  endpoint: string;
  keyDescribe: string;
  keyResolved: boolean;
  probeApiKey: string | null;
}

export function describeProviderChain(config: CarapaceConfig, model?: string): ProviderChainEntry[] {
  return providerEntriesFromConfig(config, model).map((spec) => {
    const resolved = spec.apiKey === null ? "" : resolveSecret(spec.apiKey);
    return {
      kind: spec.kind,
      model: spec.model,
      endpoint: spec.baseURL,
      keyDescribe: spec.apiKey === null ? "none (local)" : describeSecretValue(spec.apiKey),
      keyResolved: spec.apiKey !== null && resolved !== null,
      probeApiKey: resolved,
    };
  });
}

/** Adapt a CarapaceStore to the channel offset-persistence contract. */
export function channelStateAdapter(store: CarapaceStore): OffsetPersistence {
  return {
    get: (key) => store.getChannelState(key),
    set: (key, value) => store.setChannelState(key, value),
  };
}

/** Session/busy-queue key: channel+chat unless the adapter supplies an override
 * (Telegram Business chats keep separate sessions, #20786). */
function sessionKeyOf(message: ChannelMessage): string {
  return message.sessionKey ?? `${message.channel}:${message.chatId}`;
}

export function buildRuntime(options: RuntimeOptions): GatewayRuntime {
  const { config } = options;
  const store = options.store ?? new CarapaceStore(config.storage.path);
  const provider = options.provider ?? createProviderFromConfig(config);
  const agent: AgentRuntime = {
    config,
    provider,
    tools: createBuiltinTools(config),
    sessions: new SessionStore(store),
    skills: options.skills,
    // Memory (M9): plain files under the workspace — injectable for tests.
    memory: options.memory ?? new MemoryStore(join(carapaceHome(), "workspace")),
  };

  // Per-sender model overrides (#81271): providers are built lazily per model
  // name and cached for the lifetime of the runtime.
  const providerForModel =
    options.providerForModel ?? ((model: string) => createProviderFromConfig(config, model));
  const modelProviders = new Map<string, ChatProvider>();
  const providerForModelCached = (model: string): ChatProvider => {
    const cached = modelProviders.get(model);
    if (cached !== undefined) return cached;
    const created = providerForModel(model);
    modelProviders.set(model, created);
    return created;
  };

  const channels: ChannelAdapter[] = [
    new ApiChannel(config, agent.sessions),
    new TelegramChannel(config, {
      sessions: agent.sessions,
      offsetStore: channelStateAdapter(store),
      ...options.telegramOptions,
    }),
    new DiscordChannel(config, options.discordOptions),
  ];

  // Completion routing (#27445): when agent.announceTarget points at a different
  // chat, the full reply is delivered there and the origin chat gets a short
  // routing notice. Unreachable targets (unknown, disabled, or reply-in-band
  // channels) and failed sends degrade to replying in place — nothing is lost.
  const announceTarget = config.agent.announceTarget ?? null;
  let announceWarned = false;
  const announceFallbackNotice = (reason: string): void => {
    if (announceWarned) return;
    announceWarned = true;
    console.warn(
      `[runtime] agent.announceTarget ${announceTarget?.channel}:${announceTarget?.chatId} unusable (${reason}) — replies stay in the origin chat`,
    );
  };

  // One session per channel chat; sessions persist across gateway restarts.
  const runTurn = async (message: ChannelMessage): Promise<ChannelReply> => {
    const sessionId = sessionKeyOf(message);
    // Per-sender routing (#81271): first matching route scopes the toolset and/or model.
    const route = resolveSenderRoute(config, message);
    const result = await runAgentTurn(
      {
        sessionId,
        text: message.text,
        channel: message.channel,
        senderId: message.senderId,
        tools: route?.allowTools !== undefined ? agent.tools.filter(route.allowTools) : undefined,
        provider: route?.model !== undefined ? providerForModelCached(route.model) : undefined,
      },
      agent,
    );
    if (announceTarget === null) return { text: result.reply };
    if (message.channel === announceTarget.channel && message.chatId === announceTarget.chatId) {
      return { text: result.reply };
    }

    const adapter = channels.find((candidate) => candidate.name === announceTarget.channel);
    if (adapter === undefined || !adapter.isConfigured() || adapter.pushCapable === false) {
      announceFallbackNotice(
        adapter === undefined
          ? "unknown channel"
          : adapter.pushCapable === false
            ? "reply-in-band channel"
            : "channel not configured",
      );
      return { text: result.reply };
    }
    try {
      await adapter.send(announceTarget.chatId, result.reply);
      return {
        text:
          `↗ completed — the full reply was routed to ${announceTarget.channel}:${announceTarget.chatId} ` +
          "(agent.announceTarget)",
      };
    } catch (error) {
      return {
        text: `${result.reply}\n\n(announceTarget delivery failed: ${(error as Error).message} — replying here instead)`,
      };
    }
  };

  // Busy gate: one in-flight turn per chat; further messages wait in a bounded
  // queue (gateway.busyQueueLimit, default 10). When the queue is full the message
  // is refused with BusyTurnError — channels translate that into a notice
  // (Telegram) or HTTP 429 (API). Nothing is dropped silently.
  const busyQueueLimit = config.gateway.busyQueueLimit ?? 10;
  const queues = new Map<string, PendingTurn[]>();
  const pumping = new Set<string>();
  const idleWaiters: Array<() => void> = [];

  const pump = async (key: string): Promise<void> => {
    for (;;) {
      const queue = queues.get(key);
      const next = queue?.shift();
      if (next === undefined) {
        queues.delete(key);
        pumping.delete(key);
        if (queues.size === 0) {
          for (const wake of idleWaiters.splice(0)) wake();
        }
        return;
      }
      try {
        next.resolve(await runTurn(next.message));
      } catch (error: unknown) {
        next.reject(error);
      }
    }
  };

  const handleMessage = (message: ChannelMessage): Promise<ChannelReply> => {
    const key = sessionKeyOf(message);
    return new Promise<ChannelReply>((resolve, reject) => {
      let queue = queues.get(key);
      if (queue === undefined) {
        queue = [];
        queues.set(key, queue);
      }
      if (queue.length >= busyQueueLimit) {
        reject(new BusyTurnError(key, busyQueueLimit));
      } else {
        queue.push({ message, resolve, reject });
      }
      if (!pumping.has(key)) {
        pumping.add(key);
        void pump(key);
      }
    });
  };

  const waitUntilIdle = (timeoutMs: number = 30_000): Promise<boolean> => {
    if (queues.size === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer: unknown;
      const wake = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      timer = setTimeout(() => {
        const index = idleWaiters.indexOf(wake);
        if (index >= 0) idleWaiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      idleWaiters.push(wake);
    });
  };

  const routes = new RouteTable();
  for (const channel of channels) channel.mountRoutes?.(routes);
  // Web dashboard + theme system (#28300): /ui plus its status/config/messages/reset
  // endpoints, backed by the same store, sessions, and bearer-auth model.
  mountDashboardRoutes(routes, {
    config,
    sessions: agent.sessions,
    store,
    channels,
  });
  // Plugin-UI foundation (#66944): manifest endpoint + one exact-match route set
  // per loaded plugin; broken manifests surface as warnings, never as crashes.
  const pluginScan = scanPlugins(config);
  for (const issue of pluginScan.issues) console.warn(`[plugins] ${issue}`);
  mountPluginRoutes(routes, config, pluginScan);
  for (const channel of channels) channel.onMessage(handleMessage);

  return {
    agent,
    channels,
    routes,
    handleMessage,
    waitUntilIdle,
    // Automations (M8): the scheduler holds references to the store/agent/channels;
    // the CLI starts it after the channels are up and stops it at shutdown.
    scheduler: config.automations?.enabled === false ? undefined : new Scheduler({
      store,
      agent,
      channels,
      tickMs: config.automations?.tickMs ?? 30_000,
    }),
    close: () => store.close(),
  };
}