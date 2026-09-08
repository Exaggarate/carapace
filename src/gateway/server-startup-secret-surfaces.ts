import type { CarapaceConfig } from "../config/types.carapace.js";
import { isTruthyEnvValue } from "../infra/env.js";

export function resolveGatewayStartupSourceConfig(
  config: CarapaceConfig,
  env: NodeJS.ProcessEnv,
): CarapaceConfig {
  const skipChannels =
    isTruthyEnvValue(env.CARAPACE_SKIP_CHANNELS) || isTruthyEnvValue(env.CARAPACE_SKIP_PROVIDERS);
  if (!skipChannels || !config.channels) {
    return config;
  }
  return {
    ...config,
    channels: undefined,
  };
}
