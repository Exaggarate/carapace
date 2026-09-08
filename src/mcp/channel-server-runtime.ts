import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { VERSION } from "../version.js";
import { CarapaceChannelBridge } from "./channel-bridge.js";
import { ClaudePermissionRequestSchema, type ClaudeChannelMode } from "./channel-shared.js";
import { getChannelMcpCapabilities, registerChannelMcpTools } from "./channel-tools.js";

async function resolveMcpConfig(config: CarapaceConfig | undefined): Promise<CarapaceConfig> {
  if (config) {
    return config;
  }
  const { getRuntimeConfig } = await import("../config/config.js");
  return getRuntimeConfig();
}

export async function createChannelMcpRuntime(
  opts: {
    gatewayUrl?: string;
    gatewayToken?: string;
    gatewayPassword?: string;
    config?: CarapaceConfig;
    claudeChannelMode?: ClaudeChannelMode;
    verbose?: boolean;
  } = {},
): Promise<{
  server: McpServer;
  bridge: CarapaceChannelBridge;
  start: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const cfg = await resolveMcpConfig(opts.config);
  const claudeChannelMode = opts.claudeChannelMode ?? "auto";
  const capabilities = getChannelMcpCapabilities(claudeChannelMode);
  const server = new McpServer(
    { name: "carapace", version: VERSION },
    capabilities ? { capabilities } : undefined,
  );
  const bridge = new CarapaceChannelBridge(cfg, {
    gatewayUrl: opts.gatewayUrl,
    gatewayToken: opts.gatewayToken,
    gatewayPassword: opts.gatewayPassword,
    claudeChannelMode,
    verbose: opts.verbose ?? false,
  });
  bridge.setServer(server);

  server.server.setNotificationHandler(ClaudePermissionRequestSchema, async ({ params }) => {
    await bridge.handleClaudePermissionRequest({
      requestId: params.request_id,
      toolName: params.tool_name,
      description: params.description,
      inputPreview: params.input_preview,
    });
  });
  registerChannelMcpTools(server, bridge);

  return {
    server,
    bridge,
    start: async () => {
      await bridge.start();
    },
    close: async () => {
      // Both lifecycle owners must always close; one failure cannot strand the other.
      const results = await Promise.allSettled([bridge.close(), server.close()]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "Carapace channel MCP shutdown failed");
      }
    },
  };
}
