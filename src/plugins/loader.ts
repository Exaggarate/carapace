/** Stable public facade for plugin loading and runtime-registry resolution. */
import { loadCarapacePlugins } from "./loader-runtime-load.js";
import type { PluginLoadOptions } from "./loader-types.js";
export { resolveCompatibleRuntimePluginRegistry } from "./active-runtime-registry.js";
export {
  clearPluginRegistryLoadCache,
  isPluginRegistryLoadInFlight,
  resolvePluginRegistryLoadCacheKey,
} from "./loader-cache.js";
export { loadCarapacePluginCliRegistry } from "./loader-cli-registry.js";
export {
  resolveRuntimePluginRegistry,
  acquirePluginRegistryForInspection,
} from "./loader-runtime-load.js";

/** Loads a caller-owned registry value without changing the process-wide active registry. */
export function loadPluginRegistryHandle(options: PluginLoadOptions = {}) {
  return loadCarapacePlugins({ ...options, activate: false });
}

/** Loads and installs the registry owned by a process composition root. */
export function loadAndActivateRootPluginRegistry(options: PluginLoadOptions = {}) {
  return loadCarapacePlugins({ ...options, activate: true });
}

export { loadCarapacePlugins };
export type { PluginLoadOptions };
