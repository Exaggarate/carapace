// Tavily helper module supports tavily tool config behavior.
import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
import type { CarapacePluginToolContext } from "carapace/plugin-sdk/plugin-entry";
import type { CarapacePluginApi } from "carapace/plugin-sdk/plugin-runtime";

export type TavilyToolConfigContext = Pick<
  CarapacePluginToolContext,
  "config" | "runtimeConfig" | "getRuntimeConfig"
>;

export function resolveTavilyToolConfig(
  api: CarapacePluginApi,
  ctx?: TavilyToolConfigContext,
): CarapaceConfig {
  return ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
}
