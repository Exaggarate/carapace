import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { normalizePluginsConfig } from "../plugins/config-state.js";
import { initializeNativeSessionCatalogPreferences } from "../plugins/native-session-catalog-config.js";
import type { ConfigValidationIssue, CarapaceConfig } from "./types.js";
import { validateExplicitPluginConfig } from "./validation-plugin-config.js";

const roots = createTempDirTracker();
afterEach(() => {
  vi.unstubAllEnvs();
  roots.cleanup();
});

function missingPluginWarningPaths(config: CarapaceConfig): string[] {
  const home = roots.make("carapace-catalog-preference-warnings-");
  vi.stubEnv("CARAPACE_HOME", home);
  vi.stubEnv("CARAPACE_STATE_DIR", home);
  const warnings: ConfigValidationIssue[] = [];
  const issues: ConfigValidationIssue[] = [];
  validateExplicitPluginConfig({
    raw: config,
    config,
    env: { HOME: home, CARAPACE_HOME: home, CARAPACE_STATE_DIR: home },
    applyDefaults: false,
    registry: { plugins: [], diagnostics: [] },
    knownIds: new Set(),
    normalizedPlugins: normalizePluginsConfig(config.plugins),
    ensureCompatPluginIds: () => new Set(),
    ensureOverriddenPluginIds: () => new Set(),
    replacePluginEntryConfig: () => {
      throw new Error("An absent plugin cannot replace config through its schema");
    },
    issues,
    warnings,
  });
  expect(issues).toEqual([]);
  return warnings.map(({ path }) => path);
}

describe("native catalog preferences without installed plugins", () => {
  it("does not diagnose first-write privacy defaults as missing plugins", () => {
    const config = initializeNativeSessionCatalogPreferences({});
    expect(missingPluginWarningPaths(config)).toEqual([]);
  });

  const explicitUsageCases: Array<{
    name: string;
    config: CarapaceConfig;
    warningPath: string;
  }> = [
    {
      name: "explicit enablement",
      config: { plugins: { entries: { anthropic: { enabled: true } } } },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "independent allowlist selection",
      config: { plugins: { allow: ["anthropic"] } },
      warningPath: "plugins.allow",
    },
    {
      name: "additional authored plugin configuration",
      config: {
        plugins: { entries: { anthropic: { config: { additionalSetting: "authored" } } } },
      },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "an undeclared plugin with the same setting shape",
      config: {
        plugins: {
          entries: { "external-fixture": { config: { sessionCatalog: { enabled: false } } } },
        },
      },
      warningPath: "plugins.entries.external-fixture",
    },
  ];
  it.each(explicitUsageCases)(
    "retains missing-plugin warnings for $name",
    ({ config, warningPath }) => {
      const initialized = initializeNativeSessionCatalogPreferences(config);
      expect(missingPluginWarningPaths(initialized)).toEqual([warningPath]);
    },
  );
});
