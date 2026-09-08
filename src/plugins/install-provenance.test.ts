import { describe, expect, it } from "vitest";
import type { BundledPluginSource } from "./bundled-sources.js";
import { isCarapaceTrustedPluginInstallSpec } from "./install-provenance.js";

const bundledSources = new Map<string, BundledPluginSource>([
  [
    "discord",
    {
      pluginId: "discord",
      localPath: "/opt/carapace/extensions/discord",
      npmSpec: "@carapace/discord",
    },
  ],
]);

describe("plugin install provenance", () => {
  it.each([
    "discord",
    "@carapace/discord",
    "npm:@carapace/discord",
    "/opt/carapace/extensions/discord",
    "brave",
    "npm:@carapace/brave-plugin",
    "clawhub:carapace-demo",
  ])("trusts Carapace-owned install source %s", (spec) => {
    expect(isCarapaceTrustedPluginInstallSpec(spec, bundledSources)).toBe(true);
  });

  it.each(["npm:discord", "npm:@example/plugin", "/tmp/example-plugin"])(
    "keeps arbitrary install source %s untrusted",
    (spec) => {
      expect(isCarapaceTrustedPluginInstallSpec(spec, bundledSources)).toBe(false);
    },
  );
});
