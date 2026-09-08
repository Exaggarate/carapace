import type { CarapaceConfig } from "../../config/types.carapace.js";

/** Commits a non-interactive onboard config update with pending plugin records handled first. */
export async function commitNonInteractiveOnboardConfig(params: {
  nextConfig: CarapaceConfig;
  baseConfig: CarapaceConfig;
  baseHash?: string;
  reset?: boolean;
}): Promise<CarapaceConfig> {
  const { writeWizardConfigFile } = await import("../../wizard/setup.shared.js");
  // Ordinary onboard reruns must preserve existing agents.list / bindings.
  // Only explicit --reset may allow a config size drop; see carapace#84692.
  return await writeWizardConfigFile(params.nextConfig, {
    mergeBase: params.baseConfig,
    allowConfigSizeDrop: params.reset === true,
    ...(params.baseHash !== undefined ? { baseHash: params.baseHash } : {}),
  });
}
