// Deepinfra setup module handles plugin onboarding behavior.
import {
  createAliasOnlyPresetAppliers,
  type CarapaceConfig,
} from "carapace/plugin-sdk/provider-onboard";
import { DEEPINFRA_DEFAULT_MODEL_REF } from "./provider-models.js";

export function applyDeepInfraConfig(
  cfg: CarapaceConfig,
  modelRef: string = DEEPINFRA_DEFAULT_MODEL_REF,
): CarapaceConfig {
  return createAliasOnlyPresetAppliers({ modelRef, alias: "DeepInfra" }).applyConfig(cfg);
}
