/** Core Canvas host enablement from the shipped Canvas plugin configuration surface. */
import { isRecord } from "@carapace/normalization-core/record-coerce";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { isTruthyEnvValue } from "../infra/env.js";

/** Returns whether core-owned widget hosting and tools should be active. */
export function isCoreCanvasHostEnabled(
  config?: CarapaceConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Canvas owned these shipped operator switches before hosting moved into core.
  // Core keeps reading them so existing disablement still covers the whole Canvas family.
  if (isTruthyEnvValue(env.CARAPACE_SKIP_CANVAS_HOST)) {
    return false;
  }
  const host = config?.plugins?.entries?.canvas?.config?.host;
  return !isRecord(host) || host.enabled !== false;
}
