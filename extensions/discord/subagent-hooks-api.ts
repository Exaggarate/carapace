// Discord API module exposes the plugin public contract.
import type { CarapacePluginApi } from "carapace/plugin-sdk/channel-entry-contract";
import { createLazyRuntimeModule } from "carapace/plugin-sdk/lazy-runtime";

const loadDiscordSubagentHooksModule = createLazyRuntimeModule(
  () => import("./src/subagent-hooks.js"),
);
// Subagent hooks live behind a dedicated barrel so the bundled entry can
// register one stable hook wiring path while keeping the handler module lazy.
export function registerDiscordSubagentHooks(api: CarapacePluginApi): void {
  api.on("subagent_ended", async (event) => {
    const { handleDiscordSubagentEnded } = await loadDiscordSubagentHooksModule();
    handleDiscordSubagentEnded(event);
  });
  api.on("subagent_delivery_target", async (event) => {
    const { handleDiscordSubagentDeliveryTarget } = await loadDiscordSubagentHooksModule();
    return handleDiscordSubagentDeliveryTarget(event);
  });
}
