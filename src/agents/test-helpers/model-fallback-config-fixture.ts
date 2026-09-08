/**
 * Model fallback config fixture.
 *
 * Builds a minimal config with primary and fallback models for model-selection tests.
 */
import type { CarapaceConfig } from "../../config/types.carapace.js";

export function makeModelFallbackCfg(overrides: Partial<CarapaceConfig> = {}): CarapaceConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as CarapaceConfig;
}

export function createModelFallbackConfig(primary: string, fallbacks: string[]): CarapaceConfig {
  return {
    agents: {
      defaults: {
        model: { primary, fallbacks },
      },
    },
  };
}
