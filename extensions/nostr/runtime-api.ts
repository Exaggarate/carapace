// Private runtime barrel for the bundled Nostr extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export { getPluginRuntimeGatewayRequestScope } from "carapace/plugin-sdk/plugin-runtime";
export type { PluginRuntime } from "carapace/plugin-sdk/runtime-store";
