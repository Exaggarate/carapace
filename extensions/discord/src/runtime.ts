// Discord plugin module implements runtime behavior.
import type { PluginRuntime } from "carapace/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "carapace/plugin-sdk/runtime-store";

const {
  setRuntime: setDiscordRuntime,
  tryGetRuntime: getOptionalDiscordRuntime,
  getRuntime: getDiscordRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "discord",
  errorMessage: "Discord runtime not initialized",
});
export { getDiscordRuntime, getOptionalDiscordRuntime, setDiscordRuntime };
