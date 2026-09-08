/** CLI integration coverage for plugin commands, setup, status, and registry flows. */
import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarapaceConfig } from "../config/config.js";
import { createPluginCliLoadSession } from "./cli-registry-loader.js";

const mocks = vi.hoisted(() => ({
  memoryRegister: vi.fn(),
  otherRegister: vi.fn(),
  memoryListAction: vi.fn(),
  loadCarapacePluginCliRegistry: vi.fn(),
  loadCarapacePlugins: vi.fn(),
  resolveManifestActivationPluginIds: vi.fn(),
  applyPluginAutoEnable: vi.fn(),
  resolvePluginMetadataSnapshot: vi.fn(),
  loadConfig: vi.fn(),
  getRuntimeConfigSnapshot: vi.fn(),
  readConfigFileSnapshot: vi.fn(),
}));

vi.mock("./loader.js", () => ({
  loadCarapacePluginCliRegistry: (...args: unknown[]) =>
    mocks.loadCarapacePluginCliRegistry(...args),
  loadCarapacePlugins: (...args: unknown[]) => mocks.loadCarapacePlugins(...args),
  loadPluginRegistryHandle: (options: Record<string, unknown> = {}) =>
    mocks.loadCarapacePlugins({ ...options, activate: false }),
}));

vi.mock("./activation-planner.js", () => ({
  resolveManifestActivationPluginIds: (...args: unknown[]) =>
    mocks.resolveManifestActivationPluginIds(...args),
}));

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: (...args: unknown[]) => mocks.applyPluginAutoEnable(...args),
}));

vi.mock("../config/io.plugin-metadata.js", () => ({
  resolveConfigWidePluginMetadataSnapshot: (...args: unknown[]) =>
    mocks.resolvePluginMetadataSnapshot(...args),
}));

vi.mock("./plugin-metadata-snapshot.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plugin-metadata-snapshot.js")>()),
  isPluginMetadataSnapshotCompatible: () => true,
  rebasePluginMetadataSnapshotManifestRegistry: <T>(snapshot: T) => snapshot,
  resolvePluginMetadataSnapshot: (...args: unknown[]) =>
    mocks.resolvePluginMetadataSnapshot(...args),
}));

vi.mock("../config/config.js", () => ({
  getRuntimeConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  getRuntimeConfigSnapshot: (...args: unknown[]) => mocks.getRuntimeConfigSnapshot(...args),
  loadConfig: (...args: unknown[]) => mocks.loadConfig(...args),
  readConfigFileSnapshot: (...args: unknown[]) => mocks.readConfigFileSnapshot(...args),
}));

let getPluginCliCommandDescriptors: typeof import("./cli.js").getPluginCliCommandDescriptors;
let registerPluginCliCommands: typeof import("./cli.js").registerPluginCliCommands;
let registerPluginCliCommandsFromValidatedConfig: typeof import("./cli.js").registerPluginCliCommandsFromValidatedConfig;

function createProgram(existingCommandName?: string) {
  const program = new Command();
  if (existingCommandName) {
    program.command(existingCommandName);
  }
  return program;
}

function createCliRegistry(params?: {
  memoryCommands?: string[];
  memoryDescriptors?: Array<{
    name: string;
    description: string;
    hasSubcommands: boolean;
  }>;
  memoryParentPath?: string[];
}) {
  return {
    cliRegistrars: [
      {
        pluginId: "memory-core",
        register: mocks.memoryRegister,
        parentPath: params?.memoryParentPath ?? [],
        commands: params?.memoryCommands ?? ["memory"],
        descriptors: params?.memoryDescriptors ?? [
          {
            name: "memory",
            description: "Memory commands",
            hasSubcommands: true,
          },
        ],
        source: "bundled",
      },
      {
        pluginId: "other",
        register: mocks.otherRegister,
        parentPath: [],
        commands: ["other"],
        descriptors: [],
        source: "bundled",
      },
    ],
  };
}

function createAutoEnabledCliFixture() {
  const rawConfig = {
    plugins: {},
    channels: { demo: { enabled: true } },
  } as CarapaceConfig;
  const autoEnabledConfig = {
    ...rawConfig,
    plugins: {
      entries: {
        demo: { enabled: true },
      },
    },
  } as CarapaceConfig;
  return { rawConfig, autoEnabledConfig };
}

function createCliMetadataSnapshot() {
  const plugin = {
    id: "matrix",
    origin: "bundled",
    format: "carapace",
    cliCommands: [
      {
        name: "matrix",
        description: "Matrix channel utilities",
        hasSubcommands: true,
      },
    ],
  };
  return {
    policyHash: "test",
    index: {
      installRecords: {},
      plugins: [{ pluginId: "matrix", enabled: true, enabledByDefault: true, origin: "bundled" }],
    },
    manifestRegistry: { plugins: [plugin], diagnostics: [] },
    plugins: [plugin],
    diagnostics: [],
    byPluginId: new Map([[plugin.id, plugin]]),
    owners: {},
  };
}

function createLegacyExternalCliMetadataSnapshot() {
  const plugin = {
    id: "legacy-cli",
    origin: "config",
    format: "carapace",
  };
  return {
    policyHash: "test",
    index: {
      installRecords: {},
      plugins: [{ pluginId: plugin.id, enabled: true, origin: plugin.origin }],
    },
    manifestRegistry: { plugins: [plugin], diagnostics: [] },
    plugins: [plugin],
    diagnostics: [],
    byPluginId: new Map([[plugin.id, plugin]]),
    owners: {},
  };
}

function getMockCallObject(mock: ReturnType<typeof vi.fn>, callIndex = 0, argIndex = 0) {
  const value = mock.mock.calls[callIndex]?.[argIndex];
  if (!value || typeof value !== "object") {
    throw new Error(`expected mock call ${callIndex} arg ${argIndex} object`);
  }
  return value as Record<string, unknown>;
}

function expectAutoEnabledCliLoad(params: {
  rawConfig: CarapaceConfig;
  autoEnabledConfig: CarapaceConfig;
  autoEnabledReasons?: Record<string, string[]>;
}) {
  expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith(
    expect.objectContaining({
      config: params.rawConfig,
      env: process.env,
    }),
  );
  const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
  expect(loadOptions.config).toBe(params.autoEnabledConfig);
  expect(loadOptions.activationSourceConfig).toBe(params.rawConfig);
  expect(loadOptions.autoEnabledReasons).toEqual(params.autoEnabledReasons ?? {});
}

describe("registerPluginCliCommands", () => {
  beforeAll(async () => {
    ({
      getPluginCliCommandDescriptors,
      registerPluginCliCommands,
      registerPluginCliCommandsFromValidatedConfig,
    } = await import("./cli.js"));
  });

  beforeEach(() => {
    mocks.memoryRegister.mockReset();
    mocks.memoryRegister.mockImplementation(({ program }: { program: Command }) => {
      const memory = program.command("memory").description("Memory commands");
      memory.command("list").action(mocks.memoryListAction);
    });
    mocks.otherRegister.mockReset();
    mocks.otherRegister.mockImplementation(({ program }: { program: Command }) => {
      program.command("other").description("Other commands");
    });
    mocks.memoryListAction.mockReset();
    mocks.loadCarapacePluginCliRegistry.mockReset();
    mocks.loadCarapacePluginCliRegistry.mockResolvedValue(createCliRegistry());
    mocks.loadCarapacePlugins.mockReset();
    mocks.loadCarapacePlugins.mockReturnValue({
      ...createCliRegistry(),
      diagnostics: [],
    });
    mocks.resolveManifestActivationPluginIds.mockReset();
    mocks.resolveManifestActivationPluginIds.mockReturnValue([]);
    mocks.applyPluginAutoEnable.mockReset();
    mocks.resolvePluginMetadataSnapshot.mockReset();
    mocks.resolvePluginMetadataSnapshot.mockReturnValue(undefined);
    mocks.applyPluginAutoEnable.mockImplementation(({ config }) => ({
      config,
      changes: [],
      autoEnabledReasons: {},
    }));
    mocks.loadConfig.mockReset();
    mocks.loadConfig.mockReturnValue({} as CarapaceConfig);
    mocks.getRuntimeConfigSnapshot.mockReset();
    mocks.getRuntimeConfigSnapshot.mockReturnValue(null);
    mocks.readConfigFileSnapshot.mockReset();
    mocks.readConfigFileSnapshot.mockResolvedValue({
      valid: true,
      config: {},
      runtimeConfig: {},
    });
  });

  it("skips plugin CLI registrars when commands already exist", async () => {
    const program = createProgram("memory");

    await registerPluginCliCommands(program, {} as CarapaceConfig);

    expect(mocks.memoryRegister).not.toHaveBeenCalled();
    expect(mocks.otherRegister).toHaveBeenCalledTimes(1);
  });

  it("skips plugin CLI registrars when an existing command alias matches", async () => {
    const program = createProgram();
    // Alias-only root names (e.g. cron|automations) are owned commands too.
    program.command("mem-core").alias("memory");

    await registerPluginCliCommands(program, {} as CarapaceConfig);

    expect(mocks.memoryRegister).not.toHaveBeenCalled();
    expect(mocks.otherRegister).toHaveBeenCalledTimes(1);
  });

  it("forwards an explicit env to plugin loading", async () => {
    const env = { CARAPACE_HOME: "/srv/carapace-home" } as NodeJS.ProcessEnv;

    await registerPluginCliCommands(createProgram(), {} as CarapaceConfig, env);

    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
    expect(loadOptions.env).toEqual(env);
    expect(loadOptions.env).not.toBe(env);
  });

  it("injects gateway-backed node runtime into plugin CLI commands", async () => {
    await registerPluginCliCommands(createProgram(), {} as CarapaceConfig);

    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins) as {
      runtimeOptions?: { nodes?: { list?: unknown; invoke?: unknown } };
    };
    expect(typeof loadOptions.runtimeOptions?.nodes?.list).toBe("function");
    expect(typeof loadOptions.runtimeOptions?.nodes?.invoke).toBe("function");
  });

  it("reuses loaded plugin CLI entries within one exact invocation", async () => {
    const program = createProgram();
    const config = {};
    const session = createPluginCliLoadSession();

    await registerPluginCliCommands(program, config, undefined, undefined, { session });
    await registerPluginCliCommands(program, config, undefined, undefined, { session });

    expect(mocks.loadCarapacePlugins).toHaveBeenCalledTimes(1);
    session.close();
  });

  it("reloads plugin CLI entries when the requested primary command changes", async () => {
    const program = createProgram();

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      primary: "memory",
    });
    await registerPluginCliCommands(program, {} as CarapaceConfig);

    expect(mocks.loadCarapacePlugins).toHaveBeenCalledTimes(2);
  });

  it("reloads plugin CLI entries when config or environment identity changes", async () => {
    const program = createProgram();
    const configA = {} as CarapaceConfig;
    const configB = { plugins: {} } as CarapaceConfig;
    const envA = { CARAPACE_HOME: "/tmp/a" } as NodeJS.ProcessEnv;
    const envB = { CARAPACE_HOME: "/tmp/b" } as NodeJS.ProcessEnv;

    await registerPluginCliCommands(program, configA, envA);
    await registerPluginCliCommands(program, configA, envB);
    await registerPluginCliCommands(program, configB, envB);

    expect(mocks.loadCarapacePlugins).toHaveBeenCalledTimes(3);
  });

  it("loads plugin CLI commands from the auto-enabled config snapshot", async () => {
    const { rawConfig, autoEnabledConfig } = createAutoEnabledCliFixture();
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: [],
      autoEnabledReasons: {
        demo: ["demo configured"],
      },
    });

    await registerPluginCliCommands(createProgram(), rawConfig);

    expectAutoEnabledCliLoad({
      rawConfig,
      autoEnabledConfig,
      autoEnabledReasons: {
        demo: ["demo configured"],
      },
    });
    const registerOptions = getMockCallObject(mocks.memoryRegister);
    expect(registerOptions.config).toBe(autoEnabledConfig);
  });

  it("loads root-help descriptors from manifests without entering the plugin module loader", async () => {
    const { rawConfig, autoEnabledConfig } = createAutoEnabledCliFixture();
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: [],
      autoEnabledReasons: {
        demo: ["demo configured"],
      },
    });
    mocks.resolvePluginMetadataSnapshot.mockReturnValue(createCliMetadataSnapshot());

    await expect(getPluginCliCommandDescriptors(rawConfig)).resolves.toEqual([
      {
        name: "matrix",
        description: "Matrix channel utilities",
        hasSubcommands: true,
      },
    ]);
    const { renderRootHelpText } = await import("../cli/program/root-help.js");
    const help = await renderRootHelpText({ config: rawConfig });
    expect(help).toContain("matrix *");
    expect(help).toContain("Matrix channel utilities");
    expect(mocks.loadCarapacePluginCliRegistry).not.toHaveBeenCalled();
    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith(
      expect.objectContaining({ config: rawConfig }),
    );
    expect(autoEnabledConfig.plugins?.entries?.demo?.enabled).toBe(true);
  });

  it("keeps root-help descriptor load failures quiet", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as unknown as typeof process.stderr.write);
    mocks.loadCarapacePluginCliRegistry.mockImplementationOnce((options: { logger?: unknown }) => {
      const logger = options.logger as { error?: (message: string) => void };
      logger.error?.("[plugins] stale failed to load from /tmp/stale: boom");
      throw new Error("boom");
    });
    mocks.resolvePluginMetadataSnapshot.mockReturnValue(createLegacyExternalCliMetadataSnapshot());

    await expect(
      getPluginCliCommandDescriptors({
        plugins: { entries: { "legacy-cli": { enabled: true } } },
      } as CarapaceConfig),
    ).resolves.toEqual([]);

    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("preserves manifest-backed root help when an unrelated legacy CLI plugin fails", async () => {
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as unknown as typeof process.stderr.write);
    const healthySnapshot = createCliMetadataSnapshot();
    const legacySnapshot = createLegacyExternalCliMetadataSnapshot();
    const plugins = [
      ...healthySnapshot.plugins.map((plugin) => ({
        ...plugin,
        cliCommands: [...plugin.cliCommands, ...plugin.cliCommands],
      })),
      ...legacySnapshot.plugins,
    ];
    mocks.resolvePluginMetadataSnapshot.mockReturnValue({
      ...healthySnapshot,
      index: {
        ...healthySnapshot.index,
        plugins: [...healthySnapshot.index.plugins, ...legacySnapshot.index.plugins],
      },
      manifestRegistry: { plugins, diagnostics: [] },
      plugins,
      byPluginId: new Map(plugins.map((plugin) => [plugin.id, plugin])),
    });
    mocks.loadCarapacePluginCliRegistry.mockRejectedValue(new Error("broken legacy CLI plugin"));
    const config = {
      plugins: { entries: { "legacy-cli": { enabled: true } } },
    } as CarapaceConfig;

    await expect(getPluginCliCommandDescriptors(config)).resolves.toEqual([
      {
        name: "matrix",
        description: "Matrix channel utilities",
        hasSubcommands: true,
      },
    ]);
    const { renderRootHelpText } = await import("../cli/program/root-help.js");
    await expect(renderRootHelpText({ config })).resolves.toContain("matrix *");
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(getMockCallObject(mocks.loadCarapacePluginCliRegistry).onlyPluginIds).toEqual([
      "legacy-cli",
    ]);
  });

  it("preserves root help for external plugins without manifest CLI descriptors", async () => {
    const config = {
      plugins: {
        entries: { "legacy-cli": { enabled: true } },
      },
    } as CarapaceConfig;
    mocks.resolvePluginMetadataSnapshot.mockReturnValue(createLegacyExternalCliMetadataSnapshot());
    mocks.loadCarapacePluginCliRegistry.mockResolvedValue({
      cliRegistrars: [
        {
          pluginId: "legacy-cli",
          register: vi.fn(),
          parentPath: [],
          commands: ["legacy"],
          descriptors: [
            {
              name: "legacy",
              description: "Legacy external command",
              hasSubcommands: true,
            },
          ],
          source: "/tmp/legacy-cli/index.js",
        },
      ],
    });

    await expect(getPluginCliCommandDescriptors(config)).resolves.toEqual([
      {
        name: "legacy",
        description: "Legacy external command",
        hasSubcommands: true,
      },
    ]);
    expect(getMockCallObject(mocks.loadCarapacePluginCliRegistry).onlyPluginIds).toEqual([
      "legacy-cli",
    ]);
  });

  it("keeps runtime CLI command registration on the full plugin loader for legacy channel plugins", async () => {
    const { rawConfig, autoEnabledConfig } = createAutoEnabledCliFixture();
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: [],
      autoEnabledReasons: {
        demo: ["demo configured"],
      },
    });
    mocks.loadCarapacePlugins.mockReturnValue(
      createCliRegistry({
        memoryCommands: ["legacy-channel"],
        memoryDescriptors: [
          {
            name: "legacy-channel",
            description: "Legacy channel commands",
            hasSubcommands: true,
          },
        ],
      }),
    );

    await registerPluginCliCommands(createProgram(), rawConfig, undefined, undefined, {
      mode: "lazy",
    });

    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
    expect(loadOptions.config).toBe(autoEnabledConfig);
    expect(loadOptions.activationSourceConfig).toBe(rawConfig);
    expect(loadOptions.autoEnabledReasons).toEqual({
      demo: ["demo configured"],
    });
    expect(loadOptions.cache).toBe(false);
    expect(loadOptions.channelPluginLoadIntent).toBe("full");
    expect(mocks.loadCarapacePluginCliRegistry).not.toHaveBeenCalled();
  });

  it("lazy-registers descriptor-backed plugin commands on first invocation", async () => {
    const program = createProgram();
    program.exitOverride();

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
    });

    expect(program.commands.map((command) => command.name())).toEqual(["memory", "other"]);
    expect(mocks.memoryRegister).not.toHaveBeenCalled();
    expect(mocks.otherRegister).toHaveBeenCalledTimes(1);

    await program.parseAsync(["memory", "list"], { from: "user" });

    expect(mocks.memoryRegister).toHaveBeenCalledTimes(1);
    expect(mocks.memoryListAction).toHaveBeenCalledTimes(1);
  });

  it("falls back to eager registration when descriptors do not cover every command root", async () => {
    mocks.loadCarapacePlugins.mockReturnValue(
      createCliRegistry({
        memoryCommands: ["memory", "memory-admin"],
        memoryDescriptors: [
          {
            name: "memory",
            description: "Memory commands",
            hasSubcommands: true,
          },
        ],
      }),
    );
    mocks.memoryRegister.mockImplementation(({ program }: { program: Command }) => {
      program.command("memory");
      program.command("memory-admin");
    });

    await registerPluginCliCommands(createProgram(), {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
    });

    expect(mocks.memoryRegister).toHaveBeenCalledTimes(1);
  });

  it("registers a selected plugin primary eagerly during lazy startup", async () => {
    const program = createProgram();
    program.exitOverride();
    mocks.resolveManifestActivationPluginIds.mockReturnValue(["memory-core"]);

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
      primary: "memory",
    });

    expect(
      program.commands.reduce((count, command) => count + (command.name() === "memory" ? 1 : 0), 0),
    ).toBe(1);
    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
    expect(loadOptions.onlyPluginIds).toEqual(["memory-core"]);

    await program.parseAsync(["memory", "list"], { from: "user" });

    expect(mocks.memoryRegister).toHaveBeenCalledTimes(1);
    expect(mocks.memoryListAction).toHaveBeenCalledTimes(1);
  });

  it("registers nested plugin commands against their parent command", async () => {
    const program = createProgram("nodes");
    program.exitOverride();
    mocks.resolveManifestActivationPluginIds.mockReturnValue(["memory-core"]);
    mocks.loadCarapacePlugins.mockReturnValue(
      createCliRegistry({
        memoryParentPath: ["nodes"],
        memoryCommands: ["canvas"],
        memoryDescriptors: [
          {
            name: "canvas",
            description: "Canvas commands",
            hasSubcommands: true,
          },
        ],
      }),
    );
    mocks.memoryRegister.mockImplementation(({ program: programLocal }: { program: Command }) => {
      const canvas = programLocal.command("canvas").description("Canvas commands");
      canvas.command("snapshot").action(mocks.memoryListAction);
    });

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
      primary: "nodes",
    });

    const nodes = program.commands.find((command) => command.name() === "nodes");
    expect(nodes?.commands.map((command) => command.name())).toEqual(["canvas"]);

    await program.parseAsync(["nodes", "canvas", "snapshot"], { from: "user" });

    expect(mocks.memoryRegister).toHaveBeenCalledTimes(1);
    expect(getMockCallObject(mocks.memoryRegister).program).toBe(nodes);
    expect(mocks.memoryListAction).toHaveBeenCalledTimes(1);
  });

  it("scopes full CLI loading through CLI metadata when manifest planning finds no plugin match", async () => {
    const program = createProgram();
    program.exitOverride();

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
      primary: "memory",
    });

    expect(mocks.loadCarapacePluginCliRegistry).toHaveBeenCalled();
    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
    expect(loadOptions.onlyPluginIds).toEqual(["memory-core"]);
  });

  it("scopes nested CLI loading through CLI metadata parent paths", async () => {
    const nestedRegistry = createCliRegistry({
      memoryParentPath: ["nodes"],
      memoryCommands: ["canvas"],
      memoryDescriptors: [
        {
          name: "canvas",
          description: "Canvas commands",
          hasSubcommands: true,
        },
      ],
    });
    mocks.loadCarapacePluginCliRegistry.mockResolvedValue(nestedRegistry);
    mocks.loadCarapacePlugins.mockReturnValue(nestedRegistry);
    const program = createProgram("nodes");
    program.exitOverride();

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
      primary: "nodes",
    });

    const loadOptions = getMockCallObject(mocks.loadCarapacePlugins);
    expect(loadOptions.onlyPluginIds).toEqual(["memory-core"]);
  });

  it("skips full plugin runtime loading when no metadata owns the requested primary", async () => {
    const program = createProgram();
    program.exitOverride();

    await registerPluginCliCommands(program, {} as CarapaceConfig, undefined, undefined, {
      mode: "lazy",
      primary: "missing-command",
    });

    expect(mocks.loadCarapacePluginCliRegistry).toHaveBeenCalled();
    expect(mocks.loadCarapacePlugins).not.toHaveBeenCalled();
    expect(program.commands.map((command) => command.name())).not.toContain("missing-command");
  });

  it("reuses the validated cold snapshot runtime config without a second config read", async () => {
    const snapshotConfig = { plugins: { enabled: true } } as CarapaceConfig;
    mocks.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: true,
      config: {},
      runtimeConfig: snapshotConfig,
    });

    await expect(registerPluginCliCommandsFromValidatedConfig(createProgram())).resolves.toBe(
      snapshotConfig,
    );
    expect(mocks.getRuntimeConfigSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadConfig).not.toHaveBeenCalled();
  });

  it("skips unrelated plugin validation for cold plugin-owned CLI commands", async () => {
    const snapshotConfig = { plugins: { enabled: true } } as CarapaceConfig;
    mocks.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: true,
      config: {},
      runtimeConfig: snapshotConfig,
    });

    await expect(
      registerPluginCliCommandsFromValidatedConfig(createProgram(), undefined, undefined, {
        skipPluginValidation: true,
      }),
    ).resolves.toBe(snapshotConfig);
    expect(mocks.readConfigFileSnapshot).toHaveBeenCalledWith({ skipPluginValidation: true });
  });

  it("preserves an already-active runtime config snapshot", async () => {
    const snapshotConfig = { plugins: { enabled: true } } as CarapaceConfig;
    const activeConfig = { plugins: { enabled: false } } as CarapaceConfig;
    mocks.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: true,
      config: {},
      runtimeConfig: snapshotConfig,
    });
    mocks.getRuntimeConfigSnapshot.mockReturnValueOnce(activeConfig);

    await expect(registerPluginCliCommandsFromValidatedConfig(createProgram())).resolves.toBe(
      activeConfig,
    );
    expect(mocks.loadConfig).not.toHaveBeenCalled();
  });

  it("reports invalid configuration without loading plugins", async () => {
    mocks.readConfigFileSnapshot.mockResolvedValueOnce({
      valid: false,
      path: "/tmp/carapace.json",
      config: { plugins: { load: { paths: ["/tmp/unvalidated-plugin"] } } },
      issues: [{ path: "gateway.port", message: "Expected a number" }],
    });

    await expect(
      registerPluginCliCommandsFromValidatedConfig(createProgram()),
    ).rejects.toMatchObject({
      code: "INVALID_CONFIG",
      message: "Invalid config at /tmp/carapace.json:\n- gateway.port: Expected a number",
    });
    expect(mocks.getRuntimeConfigSnapshot).not.toHaveBeenCalled();
    expect(mocks.loadCarapacePlugins).not.toHaveBeenCalled();
  });
});
