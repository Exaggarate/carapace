import { collectConfigRuntimeEnvVars } from "./env-vars.js";
import type { CarapaceConfig } from "./types.js";

export const GATEWAY_CONFIG_SELECTION_ENV_KEYS: ReadonlySet<string> = new Set([
  "ANDROID_DATA",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "CARAPACE_AGENT_DIR",
  "CARAPACE_CONFIG_PATH",
  "CARAPACE_HOME",
  "CARAPACE_INCLUDE_ROOTS",
  "CARAPACE_NIX_MODE",
  "CARAPACE_OAUTH_DIR",
  "CARAPACE_PACKAGE_DIR",
  "CARAPACE_PROFILE",
  "CARAPACE_STATE_DIR",
  "CARAPACE_WORKSPACE_DIR",
  "PI_CODING_AGENT_DIR",
  "PREFIX",
  "USERPROFILE",
]);

/** Rejects config.env changes that would retarget a running Gateway process. */
export function assertGatewayConfigEnvSelectionUnchanged(
  previousConfig: CarapaceConfig,
  nextConfig: CarapaceConfig,
): void {
  const normalize = (config: CarapaceConfig) =>
    new Map(
      Object.entries(collectConfigRuntimeEnvVars(config)).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ]),
    );
  const previous = normalize(previousConfig);
  const next = normalize(nextConfig);
  for (const key of GATEWAY_CONFIG_SELECTION_ENV_KEYS) {
    if (previous.get(key) !== next.get(key)) {
      throw new Error(
        `Config env cannot change process-stable Gateway selector ${key} during reload. Restart with the target environment instead.`,
      );
    }
  }
}
