// Gateway runtime assembly: config → provider + tools + session store + channels.
// Shared by the CLI, tests, and future entry points so there is exactly one wiring.

import { resolveSecret, type CarapaceConfig } from "../config.js";
import { runAgentTurn, type AgentRuntime, type ChatProvider } from "../core/agent.js";
import { OpenAiCompatibleProvider } from "../core/llm.js";
import { createBuiltinTools } from "../core/tools/builtins/index.js";
import { SessionStore } from "../core/session.js";
import { CarapaceStore } from "../storage/sqlite.js";
import { ApiChannel } from "./channels/api.js";
import { TelegramChannel } from "./channels/telegram.js";
import { BusyTurnError, type ChannelAdapter, type ChannelMessage, type ChannelReply, type MessageHandler } from "./channels/types.js";
import { RouteTable } from "./server.js";

export interface RuntimeOptions {
  config: CarapaceConfig;
  /** Test seam: inject a provider instead of building the OpenAI-compatible one. */
  provider?: ChatProvider;
  /** Test seam: inject a store (e.g. :memory:) instead of opening config.storage.path. */
  store?: CarapaceStore;
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
}

export function createProviderFromConfig(config: CarapaceConfig): ChatProvider {
  return new OpenAiCompatibleProvider({
    baseURL: config.llm.baseURL,
    apiKey: resolveSecret(config.llm.apiKey) ?? "",
    model: config.llm.model,
    timeoutMs: config.llm.timeoutMs,
  });
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
  };

  // One session per channel chat; sessions persist across gateway restarts.
  const runTurn = async (message: ChannelMessage): Promise<ChannelReply> => {
    const sessionId = `${message.channel}:${message.chatId}`;
    const result = await runAgentTurn(
      { sessionId, text: message.text, channel: message.channel },
      agent,
    );
    return { text: result.reply };
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
    const key = `${message.channel}:${message.chatId}`;
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

  const channels: ChannelAdapter[] = [
    new ApiChannel(config, agent.sessions),
    new TelegramChannel(config, { sessions: agent.sessions }),
  ];
  const routes = new RouteTable();
  for (const channel of channels) channel.mountRoutes?.(routes);
  for (const channel of channels) channel.onMessage(handleMessage);

  return {
    agent,
    channels,
    routes,
    handleMessage,
    waitUntilIdle,
    close: () => store.close(),
  };
}