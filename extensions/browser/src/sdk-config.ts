/**
 * Browser-local SDK config bridge.
 */
export {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
} from "carapace/plugin-sdk/runtime-config-snapshot";
export { mutateConfigFile } from "carapace/plugin-sdk/config-mutation";
export type { BrowserProfileConfig, CarapaceConfig } from "carapace/plugin-sdk/config-contracts";
export {
  normalizePluginsConfig,
  resolveEffectiveEnableState,
} from "carapace/plugin-sdk/plugin-config-runtime";
export {
  CONFIG_DIR,
  escapeRegExp,
  resolveUserPath,
} from "carapace/plugin-sdk/text-utility-runtime";
