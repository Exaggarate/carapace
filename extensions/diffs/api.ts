// Diffs API module exposes the plugin public contract.
export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export {
  definePluginEntry,
  type AnyAgentTool,
  type CarapacePluginApi,
  type CarapacePluginConfigSchema,
  type CarapacePluginToolContext,
  type PluginLogger,
} from "carapace/plugin-sdk/plugin-entry";
export { resolvePreferredCarapaceTmpDir } from "carapace/plugin-sdk/temp-path";
