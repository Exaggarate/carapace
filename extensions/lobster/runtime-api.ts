// Lobster API module exposes the plugin public contract.
export { definePluginEntry } from "carapace/plugin-sdk/core";
export type {
  AnyAgentTool,
  CarapacePluginApi,
  CarapacePluginToolContext,
  CarapacePluginToolFactory,
} from "carapace/plugin-sdk/core";
export {
  applyWindowsSpawnProgramPolicy,
  materializeWindowsSpawnProgram,
  resolveWindowsSpawnProgramCandidate,
} from "carapace/plugin-sdk/windows-spawn";
