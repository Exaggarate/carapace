// Shared base compatibility normalizers reused by core and plugin setup migrations.
import type { CarapaceConfig } from "../../../config/types.carapace.js";
import type { LegacyCodexModelIdentity } from "./codex-route-model-ref.js";
import {
  normalizeLegacyBrowserConfig,
  normalizeLegacyMistralModelDefaults,
  normalizeLegacyOpenAIModelProviderApi,
  normalizeLegacyOllamaNativeNumCtxParams,
  normalizeLegacyRuntimeModelRefs,
  normalizeLegacyNanoBananaSkill,
  normalizeLegacyTalkConfig,
  seedMissingDefaultAccountsFromSingleAccountBase,
} from "./legacy-config-core-normalizers.js";
import {
  migrateLegacyWebFetchConfig,
  migrateLegacyWebSearchConfig,
  migrateLegacyXSearchConfig,
} from "./legacy-web-tools-migrate.js";

/** Run common compatibility migrations before caller-specific setup/channel passes. */
export function normalizeBaseCompatibilityConfigValues(
  cfg: CarapaceConfig,
  changes: string[],
  afterBrowser?: (config: CarapaceConfig) => CarapaceConfig,
  blockedModelIdentities?: ReadonlySet<LegacyCodexModelIdentity>,
): CarapaceConfig {
  let next = seedMissingDefaultAccountsFromSingleAccountBase(cfg, changes);
  next = normalizeLegacyBrowserConfig(next, changes);
  next = afterBrowser ? afterBrowser(next) : next;

  for (const migrate of [
    migrateLegacyWebSearchConfig,
    migrateLegacyWebFetchConfig,
    migrateLegacyXSearchConfig,
  ]) {
    const migrated = migrate(next);
    if (migrated.changes.length === 0) {
      continue;
    }
    next = migrated.config;
    changes.push(...migrated.changes);
  }

  next = normalizeLegacyNanoBananaSkill(next, changes);
  next = normalizeLegacyTalkConfig(next, changes);
  next = normalizeLegacyOpenAIModelProviderApi(next, changes);
  next = normalizeLegacyRuntimeModelRefs(next, changes, blockedModelIdentities);
  next = normalizeLegacyOllamaNativeNumCtxParams(next, changes);
  return normalizeLegacyMistralModelDefaults(next, changes);
}
