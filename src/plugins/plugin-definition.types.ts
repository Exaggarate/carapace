import type { CarapacePluginApi } from "./plugin-api.types.js";
import type { CarapacePluginConfigSchema } from "./plugin-config-schema.types.js";
import type { PluginKind } from "./plugin-kind.types.js";
import type {
  CarapacePluginReloadRegistration,
  CarapacePluginSecurityAuditCollector,
} from "./plugin-registration.types.js";
import type { CarapacePluginNodeHostCommand } from "./types.node-host.js";

/** Module-level plugin definition loaded from a native plugin entry file. */
export type CarapacePluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  /**
   * @deprecated Declare exclusive plugin kind in `carapace.plugin.json` via
   * manifest `kind`. Runtime-exported `kind` is kept as a compatibility
   * fallback for older plugins and may require loading plugin runtime on
   * metadata-only command paths.
   */
  kind?: PluginKind | PluginKind[];
  configSchema?: CarapacePluginConfigSchema;
  reload?: CarapacePluginReloadRegistration;
  nodeHostCommands?: CarapacePluginNodeHostCommand[];
  securityAuditCollectors?: CarapacePluginSecurityAuditCollector[];
  register?: (api: CarapacePluginApi) => void;
};

export type CarapacePluginModule = CarapacePluginDefinition | ((api: CarapacePluginApi) => void);
