// Lobster plugin entrypoint registers its Carapace integration.
import { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
import type { AnyAgentTool, CarapacePluginApi, CarapacePluginToolFactory } from "./runtime-api.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default definePluginEntry({
  id: "lobster",
  name: "Lobster",
  description: "Optional local shell helper tools",
  register(api: CarapacePluginApi) {
    api.registerTool(
      ((ctx) => {
        if (ctx.sandboxed) {
          return null;
        }
        const taskFlow =
          api.runtime?.tasks.managedFlows && ctx.sessionKey
            ? api.runtime.tasks.managedFlows.fromToolContext(ctx)
            : undefined;
        return createLobsterTool(api, { taskFlow }) as AnyAgentTool;
      }) as CarapacePluginToolFactory,
      { optional: true },
    );
  },
});
