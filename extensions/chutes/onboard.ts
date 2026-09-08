import { readManifestProviderDefaultModelRef } from "carapace/plugin-sdk/provider-catalog-shared";
import {
  applyAgentDefaultModelPrimary,
  createModelCatalogPresetAppliers,
  type CarapaceConfig,
} from "carapace/plugin-sdk/provider-onboard";
import { CHUTES_BASE_URL, CHUTES_MODEL_CATALOG } from "./models.js";
import manifest from "./carapace.plugin.json" with { type: "json" };

export const CHUTES_DEFAULT_MODEL_ID = manifest.modelCatalog.providers.chutes.defaultModel;
export const CHUTES_DEFAULT_MODEL_REF = readManifestProviderDefaultModelRef(manifest, "chutes")!;

const chutesPresetAppliers = createModelCatalogPresetAppliers({
  primaryModelRef: CHUTES_DEFAULT_MODEL_REF,
  resolveParams: (cfg: CarapaceConfig) => ({
    providerId: "chutes",
    api: "openai-completions",
    baseUrl: CHUTES_BASE_URL,
    // Replace mode skips discovery; merge mode must not persist generated pricing as authored pins.
    catalogModels: cfg.models?.mode === "replace" ? structuredClone(CHUTES_MODEL_CATALOG) : [],
    aliases: [
      ...CHUTES_MODEL_CATALOG.map((model) => `chutes/${model.id}`),
      {
        modelRef: "chutes-vision",
        alias: "chutes/moonshotai/Kimi-K2.6-TEE",
      },
      { modelRef: "chutes-pro", alias: "chutes/deepseek-ai/DeepSeek-V3.2-TEE" },
    ],
  }),
});

export function applyChutesProviderConfig(cfg: CarapaceConfig): CarapaceConfig {
  return chutesPresetAppliers.applyProviderConfig(cfg);
}

export function applyChutesConfig(cfg: CarapaceConfig): CarapaceConfig {
  const next = applyChutesProviderConfig(cfg);
  return {
    ...next,
    agents: {
      ...next.agents,
      defaults: {
        ...next.agents?.defaults,
        model: {
          primary: CHUTES_DEFAULT_MODEL_REF,
          fallbacks: ["chutes/deepseek-ai/DeepSeek-V3.2-TEE", "chutes/moonshotai/Kimi-K2.6-TEE"],
        },
        imageModel: {
          primary: "chutes/moonshotai/Kimi-K2.6-TEE",
          fallbacks: ["chutes/Qwen/Qwen3.6-27B-TEE"],
        },
      },
    },
  };
}

export function applyChutesApiKeyConfig(cfg: CarapaceConfig): CarapaceConfig {
  return applyAgentDefaultModelPrimary(applyChutesProviderConfig(cfg), CHUTES_DEFAULT_MODEL_REF);
}
