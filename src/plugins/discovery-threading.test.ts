// Covers plugin discovery threading and concurrency behavior.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginDiscoveryResult } from "./discovery.js";
import * as installedPluginIndexRecordReader from "./installed-plugin-index-record-reader.js";

const discoverCarapacePluginsMock = vi.fn();

vi.mock("./discovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./discovery.js")>();
  return {
    ...actual,
    discoverCarapacePlugins: (...args: unknown[]) => discoverCarapacePluginsMock(...args),
  };
});

const { loadPluginManifestRegistryCore } = await import("./manifest-registry.js");
const { loadInstalledPluginIndexWithDiscovery } = await import("./installed-plugin-index.js");

const emptyDiscovery: PluginDiscoveryResult = { candidates: [], diagnostics: [] };

describe("discovery threading", () => {
  beforeEach(() => {
    discoverCarapacePluginsMock.mockReset();
    discoverCarapacePluginsMock.mockReturnValue(emptyDiscovery);
  });

  it("skips internal discoverCarapacePlugins when discovery is supplied", () => {
    loadPluginManifestRegistryCore({ discovery: emptyDiscovery });
    expect(discoverCarapacePluginsMock).not.toHaveBeenCalled();

    discoverCarapacePluginsMock.mockClear();
    loadInstalledPluginIndexWithDiscovery({ discovery: emptyDiscovery, installRecords: {} });
    expect(discoverCarapacePluginsMock).not.toHaveBeenCalled();
  });

  it("calls discoverCarapacePlugins when neither discovery nor candidates supplied", () => {
    loadPluginManifestRegistryCore({});
    expect(discoverCarapacePluginsMock).toHaveBeenCalledTimes(1);

    discoverCarapacePluginsMock.mockClear();
    loadInstalledPluginIndexWithDiscovery({ installRecords: {} });
    expect(discoverCarapacePluginsMock).toHaveBeenCalledTimes(1);
  });

  it("prefers explicit candidates over discovery when both are supplied", () => {
    loadPluginManifestRegistryCore({ candidates: [], diagnostics: [], discovery: emptyDiscovery });
    expect(discoverCarapacePluginsMock).not.toHaveBeenCalled();

    discoverCarapacePluginsMock.mockClear();
    loadInstalledPluginIndexWithDiscovery({
      candidates: [],
      discovery: emptyDiscovery,
      installRecords: {},
    });
    expect(discoverCarapacePluginsMock).not.toHaveBeenCalled();
  });

  it("preserves explicit candidate diagnostics without loading persisted install records", () => {
    const readInstallRecords = vi.spyOn(
      installedPluginIndexRecordReader,
      "loadInstalledPluginIndexInstallRecordsSync",
    );
    const diagnostics = [{ level: "warn" as const, message: "explicit candidate diagnostic" }];

    const result = loadInstalledPluginIndexWithDiscovery({
      candidates: [],
      diagnostics,
      installRecords: {},
    });

    expect(result.manifestRegistry.diagnostics).toEqual(diagnostics);
    expect(result.discovery).toBeUndefined();
    expect(readInstallRecords).not.toHaveBeenCalled();
    expect(discoverCarapacePluginsMock).not.toHaveBeenCalled();
  });
});
