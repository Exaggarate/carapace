// Logger browser import tests cover safe import behavior in browser-like runtimes.
import path from "node:path";
import { importFreshModule } from "carapace/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importLoggerWithMockedTempResolver(params?: {
  nodeFsAvailable?: boolean;
  resolvePreferredCarapaceTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredCarapaceTmpDir: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const resolvePreferredCarapaceTmpDir =
    params?.resolvePreferredCarapaceTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredCarapaceTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-carapace-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-carapace-dir.js")>(
      "../infra/tmp-carapace-dir.js",
    );
    return {
      ...actual,
      resolvePreferredCarapaceTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: params?.nodeFsAvailable ? (id: string) => (id === "fs" ? {} : undefined) : undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    `./logger.js?scope=${params?.nodeFsAvailable ? "node-safe" : "browser-safe"}`,
  );
  return { module, resolvePreferredCarapaceTmpDir };
}

describe("logging/logger import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-carapace-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredCarapaceTmpDir } = await importLoggerWithMockedTempResolver();

    expect(resolvePreferredCarapaceTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/carapace");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/carapace/carapace.log");
  });

  it("defers node temp resolution until active logger settings are requested", async () => {
    const secureLogDir = path.join(process.cwd(), "secure-carapace-temp");
    const resolvePreferredCarapaceTmpDir = vi.fn(() => secureLogDir);
    const { module } = await importLoggerWithMockedTempResolver({
      nodeFsAvailable: true,
      resolvePreferredCarapaceTmpDir,
    });

    expect(resolvePreferredCarapaceTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/carapace");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/carapace/carapace.log");

    module.setLoggerConfigLoaderForTests(() => undefined);
    expect(path.dirname(module.getResolvedLoggerSettings().file)).toBe(secureLogDir);
    expect(resolvePreferredCarapaceTmpDir).toHaveBeenCalledOnce();
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredCarapaceTmpDir } = await importLoggerWithMockedTempResolver();

    expect(module.getResolvedLoggerSettings()).toStrictEqual({
      level: "silent",
      file: "/tmp/carapace/carapace.log",
      maxFileBytes: 100 * 1024 * 1024,
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(module.getLogger().info("browser-safe")).toBeUndefined();
    expect(resolvePreferredCarapaceTmpDir).not.toHaveBeenCalled();
  });
});
