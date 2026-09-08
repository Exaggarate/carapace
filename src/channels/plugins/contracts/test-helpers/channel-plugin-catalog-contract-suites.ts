/**
 * External channel plugin catalog contract suites.
 *
 * Writes synthetic manifests and catalog files to prove parser behavior for discovered plugins.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePreferredCarapaceTmpDir } from "../../../../infra/tmp-carapace-dir.js";
import { listRawChannelPluginCatalogEntries } from "../../catalog.js";

type CatalogQuery = {
  catalogPaths?: string[];
  env?: NodeJS.ProcessEnv;
};

type ChannelCatalogContractCase = {
  name: string;
  setup: () => CatalogQuery & {
    channelId: string;
    expected: Record<string, unknown>;
  };
};

type RichExternalCatalogFixture = {
  name: string;
  prefix: string;
  channelId: string;
  entry: Record<string, unknown>;
  expected: Record<string, unknown>;
};

function createCatalogEntry(params: {
  packageName: string;
  channelId: string;
  label: string;
  blurb: string;
  order?: number;
}) {
  return {
    name: params.packageName,
    carapace: {
      channel: {
        id: params.channelId,
        label: params.label,
        selectionLabel: params.label,
        docsPath: `/channels/${params.channelId}`,
        blurb: params.blurb,
        ...(params.order === undefined ? {} : { order: params.order }),
      },
      install: { npmSpec: params.packageName },
    },
  };
}

function writeCatalogFile(
  catalogPath: string,
  entry: Record<string, unknown>,
  richManifest = false,
) {
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({
      ...(richManifest
        ? {
            $schema: "./manifest.schema.json",
            schemaVersion: 1,
            description:
              "Extension manifest. Declares plugin packages that Carapace can discover during onboarding and install on demand via `carapace plugins install`.",
          }
        : {}),
      entries: [entry],
    }),
  );
}

function createTemporaryCatalogFile(
  prefix: string,
  entry: Record<string, unknown>,
  richManifest = false,
) {
  const directory = fs.mkdtempSync(path.join(resolvePreferredCarapaceTmpDir(), prefix));
  const catalogPath = path.join(directory, "catalog.json");
  writeCatalogFile(catalogPath, entry, richManifest);
  return catalogPath;
}

function writeDiscoveredChannelPlugin(params: {
  stateDir: string;
  packageName: string;
  channelLabel: string;
  pluginId: string;
  blurb: string;
}) {
  const pluginDir = path.join(params.stateDir, "extensions", "demo-channel-plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, "package.json"),
    JSON.stringify({
      name: params.packageName,
      carapace: {
        extensions: ["./index.js"],
        channel: {
          id: "demo-channel",
          label: params.channelLabel,
          selectionLabel: params.channelLabel,
          docsPath: "/channels/demo-channel",
          blurb: params.blurb,
        },
        install: { npmSpec: params.packageName },
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(pluginDir, "carapace.plugin.json"),
    JSON.stringify({ id: params.pluginId, configSchema: {} }),
    "utf8",
  );
  fs.writeFileSync(path.join(pluginDir, "index.js"), "module.exports = {}", "utf8");
}

function createRichExternalCatalogCase(
  fixture: RichExternalCatalogFixture,
): ChannelCatalogContractCase {
  return {
    name: fixture.name,
    setup: () => ({
      channelId: fixture.channelId,
      catalogPaths: [createTemporaryCatalogFile(fixture.prefix, fixture.entry, true)],
      expected: fixture.expected,
    }),
  };
}

const [richNpmCatalogFixture, clawhubCatalogFixture, yuanbaoCatalogFixture] = [
  {
    name: "accepts rich external manifest entries with pinned npm metadata",
    prefix: "carapace-catalog-rich-",
    channelId: "wecom",
    entry: {
      name: "@wecom/wecom-carapace-plugin",
      description:
        "Carapace WeCom (企业微信) channel plugin — community maintained, published on npm.",
      source: "external",
      kind: "channel",
      carapace: {
        channel: {
          id: "wecom",
          label: "WeCom",
          selectionLabel: "WeCom (企业微信)",
          detailLabel: "WeCom",
          docsPath: "/channels/wecom",
          docsLabel: "wecom",
          blurb: "企业微信 (WeCom) bot & conversation channel.",
          aliases: ["qywx", "wework"],
          order: 45,
        },
        install: {
          npmSpec: "@wecom/wecom-carapace-plugin@1.2.3",
          defaultChoice: "npm",
          minHostVersion: ">=2026.4.10",
          expectedIntegrity: "sha512-wecom",
        },
      },
    },
    expected: {
      id: "wecom",
      meta: {
        label: "WeCom",
        selectionLabel: "WeCom (企业微信)",
        detailLabel: "WeCom",
        docsPath: "/channels/wecom",
        docsLabel: "wecom",
        blurb: "企业微信 (WeCom) bot & conversation channel.",
      },
      install: {
        npmSpec: "@wecom/wecom-carapace-plugin@1.2.3",
        defaultChoice: "npm",
        minHostVersion: ">=2026.4.10",
        expectedIntegrity: "sha512-wecom",
      },
      installSource: {
        defaultChoice: "npm",
        npm: {
          spec: "@wecom/wecom-carapace-plugin@1.2.3",
          packageName: "@wecom/wecom-carapace-plugin",
          selector: "1.2.3",
          selectorKind: "exact-version",
          exactVersion: true,
          expectedIntegrity: "sha512-wecom",
          pinState: "exact-with-integrity",
        },
        warnings: [],
      },
    },
  },
  {
    name: "accepts external manifest entries with ClawHub-only install metadata",
    prefix: "carapace-catalog-clawhub-",
    channelId: "clawhub-chat",
    entry: {
      source: "external",
      kind: "channel",
      carapace: {
        channel: {
          id: "clawhub-chat",
          label: "ClawHub Chat",
          selectionLabel: "ClawHub Chat",
          detailLabel: "ClawHub",
          docsPath: "/channels/clawhub-chat",
          docsLabel: "clawhub chat",
          blurb: "ClawHub-backed chat channel.",
          aliases: ["chchat"],
          order: 47,
        },
        install: {
          clawhubSpec: "clawhub:carapace/clawhub-chat@2026.5.2",
          defaultChoice: "clawhub",
          minHostVersion: ">=2026.5.1",
        },
      },
    },
    expected: {
      id: "clawhub-chat",
      meta: {
        label: "ClawHub Chat",
        selectionLabel: "ClawHub Chat",
        detailLabel: "ClawHub",
        docsPath: "/channels/clawhub-chat",
        docsLabel: "clawhub chat",
        blurb: "ClawHub-backed chat channel.",
      },
      install: {
        clawhubSpec: "clawhub:carapace/clawhub-chat@2026.5.2",
        defaultChoice: "clawhub",
        minHostVersion: ">=2026.5.1",
      },
      installSource: {
        defaultChoice: "clawhub",
        clawhub: {
          spec: "clawhub:carapace/clawhub-chat@2026.5.2",
          packageName: "carapace/clawhub-chat",
          version: "2026.5.2",
          exactVersion: true,
        },
        warnings: [],
      },
    },
  },
  {
    name: "accepts rich external manifest entries for yuanbao with pinned npm metadata",
    prefix: "carapace-catalog-yuanbao-",
    channelId: "carapace-plugin-yuanbao",
    entry: {
      name: "carapace-plugin-yuanbao",
      description:
        "Carapace Yuanbao (元宝) channel plugin — community maintained, published on npm.",
      source: "external",
      kind: "channel",
      carapace: {
        channel: {
          id: "carapace-plugin-yuanbao",
          label: "Yuanbao",
          selectionLabel: "Yuanbao (Tencent Yuanbao)",
          detailLabel: "Yuanbao",
          docsPath: "/channels/yuanbao",
          docsLabel: "yuanbao",
          blurb: "Tencent Yuanbao AI assistant conversation channel.",
          aliases: ["yb", "tencent-yuanbao"],
          order: 78,
        },
        install: {
          npmSpec: "carapace-plugin-yuanbao@1.0.0",
          defaultChoice: "npm",
          minHostVersion: ">=2026.4.10",
          expectedIntegrity: "sha512-yuanbao",
        },
      },
    },
    expected: {
      id: "carapace-plugin-yuanbao",
      meta: {
        label: "Yuanbao",
        selectionLabel: "Yuanbao (Tencent Yuanbao)",
        detailLabel: "Yuanbao",
        docsPath: "/channels/yuanbao",
        docsLabel: "yuanbao",
        blurb: "Tencent Yuanbao AI assistant conversation channel.",
      },
      install: {
        npmSpec: "carapace-plugin-yuanbao@1.0.0",
        defaultChoice: "npm",
        minHostVersion: ">=2026.4.10",
        expectedIntegrity: "sha512-yuanbao",
      },
    },
  },
] satisfies [RichExternalCatalogFixture, RichExternalCatalogFixture, RichExternalCatalogFixture];

/** Installs catalog entry tests shared by plugin registry and manifest suites. */
export function describeChannelPluginCatalogEntriesContract() {
  const cases: ChannelCatalogContractCase[] = [
    {
      name: "includes external catalog entries",
      setup: () => ({
        channelId: "demo-channel",
        catalogPaths: [
          createTemporaryCatalogFile(
            "carapace-catalog-",
            createCatalogEntry({
              packageName: "@carapace/demo-channel",
              channelId: "demo-channel",
              label: "Demo Channel",
              blurb: "Demo entry",
              order: 999,
            }),
          ),
        ],
        expected: { id: "demo-channel" },
      }),
    },
    {
      name: "preserves plugin ids when they differ from channel ids",
      setup: () => {
        const stateDir = fs.mkdtempSync(
          path.join(resolvePreferredCarapaceTmpDir(), "carapace-channel-catalog-state-"),
        );
        writeDiscoveredChannelPlugin({
          stateDir,
          packageName: "@vendor/demo-channel-plugin",
          channelLabel: "Demo Channel",
          pluginId: "@vendor/demo-runtime",
          blurb: "Demo channel",
        });
        return {
          channelId: "demo-channel",
          env: {
            ...process.env,
            CARAPACE_STATE_DIR: stateDir,
            CARAPACE_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
          },
          expected: { pluginId: "@vendor/demo-runtime" },
        };
      },
    },
    {
      name: "keeps discovered plugins ahead of external catalog overrides",
      setup: () => {
        const stateDir = fs.mkdtempSync(
          path.join(resolvePreferredCarapaceTmpDir(), "carapace-catalog-state-"),
        );
        const catalogPath = path.join(stateDir, "catalog.json");
        writeDiscoveredChannelPlugin({
          stateDir,
          packageName: "@vendor/demo-channel-plugin",
          channelLabel: "Demo Channel Runtime",
          pluginId: "@vendor/demo-channel-runtime",
          blurb: "discovered plugin",
        });
        writeCatalogFile(
          catalogPath,
          createCatalogEntry({
            packageName: "@vendor/demo-channel-catalog",
            channelId: "demo-channel",
            label: "Demo Channel Catalog",
            blurb: "external catalog",
          }),
        );
        return {
          channelId: "demo-channel",
          catalogPaths: [catalogPath],
          env: {
            ...process.env,
            CARAPACE_STATE_DIR: stateDir,
            CLAWDBOT_STATE_DIR: undefined,
            CARAPACE_BUNDLED_PLUGINS_DIR: "/nonexistent/bundled/plugins",
          },
          expected: {
            install: { npmSpec: "@vendor/demo-channel-plugin" },
            meta: { label: "Demo Channel Runtime" },
            pluginId: "@vendor/demo-channel-runtime",
          },
        };
      },
    },
    createRichExternalCatalogCase(richNpmCatalogFixture),
    {
      name: "pins bare external prerelease package specs to the entry version",
      setup: () => ({
        channelId: "prerelease-demo",
        catalogPaths: [
          createTemporaryCatalogFile("carapace-catalog-prerelease-", {
            ...createCatalogEntry({
              packageName: "@carapace/prerelease-demo-channel",
              channelId: "prerelease-demo",
              label: "Prerelease Demo",
              blurb: "Prerelease package pinning fixture",
            }),
            version: "2026.5.3-beta.1",
          }),
        ],
        expected: {
          install: { npmSpec: "@carapace/prerelease-demo-channel@2026.5.3-beta.1" },
          installSource: {
            npm: {
              spec: "@carapace/prerelease-demo-channel@2026.5.3-beta.1",
              packageName: "@carapace/prerelease-demo-channel",
              selector: "2026.5.3-beta.1",
              selectorKind: "exact-version",
              exactVersion: true,
            },
          },
        },
      }),
    },
    createRichExternalCatalogCase(clawhubCatalogFixture),
    createRichExternalCatalogCase(yuanbaoCatalogFixture),
  ];

  describe("channel plugin catalog entries contract", () => {
    it.each(cases)("$name", ({ setup }) => {
      const { channelId, expected, ...options } = setup();
      expect(
        listRawChannelPluginCatalogEntries(options).find((entry) => entry.id === channelId),
      ).toMatchObject(expected);
    });
  });
}

/** Installs catalog path resolution tests that depend on env/home/state paths. */
export function describeChannelPluginCatalogPathResolutionContract() {
  describe("channel plugin catalog path resolution contract", () => {
    it.each([
      {
        name: "uses the provided env for external catalog path resolution",
        setup: () => {
          const home = fs.mkdtempSync(
            path.join(resolvePreferredCarapaceTmpDir(), "carapace-catalog-home-"),
          );
          writeCatalogFile(
            path.join(home, "catalog.json"),
            createCatalogEntry({
              packageName: "@carapace/env-demo-channel",
              channelId: "env-demo-channel",
              label: "Env Demo Channel",
              blurb: "Env demo entry",
              order: 1000,
            }),
          );
          return {
            env: {
              ...process.env,
              CARAPACE_PLUGIN_CATALOG_PATHS: "~/catalog.json",
              CARAPACE_HOME: home,
              HOME: home,
            },
            expectedId: "env-demo-channel",
          };
        },
      },
      {
        name: "uses the provided env for default catalog paths",
        setup: () => {
          const stateDir = fs.mkdtempSync(
            path.join(resolvePreferredCarapaceTmpDir(), "carapace-catalog-state-"),
          );
          const catalogPath = path.join(stateDir, "plugins", "catalog.json");
          fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
          writeCatalogFile(
            catalogPath,
            createCatalogEntry({
              packageName: "@carapace/default-env-demo",
              channelId: "default-env-demo",
              label: "Default Env Demo",
              blurb: "Default env demo entry",
            }),
          );
          return {
            env: { ...process.env, CARAPACE_STATE_DIR: stateDir },
            expectedId: "default-env-demo",
          };
        },
      },
    ])("$name", ({ setup }) => {
      const { env, expectedId } = setup();
      expect(listRawChannelPluginCatalogEntries({ env }).map((entry) => entry.id)).toContain(
        expectedId,
      );
    });
  });
}
