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
import type { ChannelAdapter, ChannelMessage, ChannelReply, MessageHandler } from "./channels/types.js";
import { RouteTable } from "./server.js";

export interface RuntimeOptions {
  config: CarapaceConfig;
  /** Test seam: inject a provider instead of building the OpenAI-compatible one. */
  provider?: ChatProvider;
  /** Test seam: inject a store (e.g. :memory:) instead of opening config.storage.path. */
  store?: CarapaceStore;
}

export interface GatewayRuntime {
  agent: AgentRuntime;
  channels: ChannelAdapter[];
  routes: RouteTable;
  handleMessage: MessageHandler;
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
  const handleMessage = async (message: ChannelMessage): Promise<ChannelReply> => {
    const sessionId = `${message.channel}:${message.chatId}`;
    const result = await runAgentTurn(
      { sessionId, text: message.text, channel: message.channel },
      agent,
    );
    return { text: result.reply };
  };

  const channels: ChannelAdapter[] = [new ApiChannel(config), new TelegramChannel(config)];
  const routes = new RouteTable();
  for (const channel of channels) channel.mountRoutes?.(routes);
  for (const channel of channels) channel.onMessage(handleMessage);

  return {
    agent,
    channels,
    routes,
    handleMessage,
    close: () => store.close(),
  };
}