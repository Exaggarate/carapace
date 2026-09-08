// Start repair tests cover stale service repair install-plan wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayServiceState } from "../../daemon/service.js";

const buildGatewayInstallPlanMock = vi.hoisted(() =>
  vi.fn(
    async (params: {
      existingEnvironment?: Record<string, string | undefined>;
      existingEnvironmentValueSources?: Record<
        string,
        "inline" | "file" | "inline-and-file" | undefined
      >;
    }) => {
      const preservedFileValue =
        params.existingEnvironmentValueSources?.TELEGRAM_DEFAULT_BOTTOKEN === "file";
      return {
        programArguments: ["/usr/bin/carapace", "gateway", "run"],
        workingDirectory: "/tmp/carapace",
        environment: {
          TELEGRAM_DEFAULT_BOTTOKEN: preservedFileValue
            ? params.existingEnvironment?.TELEGRAM_DEFAULT_BOTTOKEN
            : "placeholder-overwritten-token",
        },
        environmentValueSources: {
          TELEGRAM_DEFAULT_BOTTOKEN: preservedFileValue ? "file" : "inline",
        },
      };
    },
  ),
);
const resolveGatewayInstallTokenMock = vi.hoisted(() => vi.fn());
const readConfigFileSnapshotForWriteMock = vi.hoisted(() => vi.fn());
const resolveGatewayPortMock = vi.hoisted(() =>
  vi.fn(
    (config: { gateway?: { port?: number } } | undefined, env: NodeJS.ProcessEnv = process.env) => {
      const portMatch = env.CARAPACE_GATEWAY_PORT?.trim().match(/(?:^|:)(\d+)$/);
      return Number(portMatch?.[1]) || config?.gateway?.port || 18_789;
    },
  ),
);
const resolveStateDirMock = vi.hoisted(() =>
  vi.fn((env: NodeJS.ProcessEnv) => env.CARAPACE_STATE_DIR?.trim() || `${env.HOME}/.carapace`),
);
const resolveConfigPathCandidateMock = vi.hoisted(() =>
  vi.fn(
    (env: NodeJS.ProcessEnv) =>
      env.CARAPACE_CONFIG_PATH?.trim() ||
      `${env.CARAPACE_STATE_DIR?.trim() || `${env.HOME}/.carapace`}/carapace.json`,
  ),
);
const resolveCarapaceWrapperPathMock = vi.hoisted(() => vi.fn());
const formatGatewayServiceStartRepairIssuesMock = vi.hoisted(() => vi.fn());
const defaultRuntimeLogMock = vi.hoisted(() => vi.fn());
const assertGatewayServiceMutationAllowedMock = vi.hoisted(() => vi.fn());
const resolveBunRuntimeInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../commands/daemon-install-helpers.js", () => ({
  buildGatewayInstallPlan: buildGatewayInstallPlanMock,
}));

vi.mock("../../commands/daemon-runtime.js", () => ({
  DEFAULT_GATEWAY_DAEMON_RUNTIME: "node",
  resolveGatewayDaemonRuntime: (programArguments: string[] | undefined) =>
    programArguments?.[0]?.endsWith("/bun") ? "bun" : "node",
}));

vi.mock("../../commands/gateway-install-token.js", () => ({
  resolveGatewayInstallToken: resolveGatewayInstallTokenMock,
}));

vi.mock("../../config/io.js", () => ({
  readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
}));

vi.mock("../../config/paths.js", () => ({
  resolveConfigPathCandidate: resolveConfigPathCandidateMock,
  resolveGatewayPort: resolveGatewayPortMock,
  resolveStateDir: resolveStateDirMock,
}));

vi.mock("../../daemon/program-args.js", () => ({
  CARAPACE_WRAPPER_ENV_KEY: "CARAPACE_WRAPPER",
  resolveCarapaceWrapperPath: resolveCarapaceWrapperPathMock,
}));

vi.mock("../../daemon/runtime-paths.js", () => ({
  resolveBunRuntimeInfo: resolveBunRuntimeInfoMock,
}));

vi.mock("../../daemon/service.js", () => ({
  formatGatewayServiceStartRepairIssues: formatGatewayServiceStartRepairIssuesMock,
}));

vi.mock("../../infra/gateway-supervision.js", () => ({
  assertGatewayServiceMutationAllowed: assertGatewayServiceMutationAllowedMock,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: { log: defaultRuntimeLogMock },
}));

const { repairLoadedGatewayServiceForStart } = await import("./start-repair.js");

function readFirstInstallPlanArg(): Record<string, unknown> {
  const [firstArg] = buildGatewayInstallPlanMock.mock.calls[0] ?? [];
  if (!firstArg) {
    throw new Error("expected first install plan call");
  }
  return firstArg as Record<string, unknown>;
}

describe("repairLoadedGatewayServiceForStart", () => {
  beforeEach(() => {
    vi.stubEnv("HOME", "/home/carapace");
    vi.stubEnv("CARAPACE_CONFIG_PATH", "");
    vi.stubEnv("CARAPACE_GATEWAY_PORT", "");
    vi.stubEnv("CARAPACE_HOME", "");
    vi.stubEnv("CARAPACE_PROFILE", "");
    vi.stubEnv("CARAPACE_STATE_DIR", "");
    buildGatewayInstallPlanMock.mockClear();
    resolveGatewayInstallTokenMock.mockReset();
    readConfigFileSnapshotForWriteMock.mockReset();
    resolveGatewayPortMock.mockClear();
    resolveCarapaceWrapperPathMock.mockReset();
    formatGatewayServiceStartRepairIssuesMock.mockReset();
    defaultRuntimeLogMock.mockClear();
    assertGatewayServiceMutationAllowedMock.mockReset();
    resolveBunRuntimeInfoMock.mockReset();
    resolveBunRuntimeInfoMock.mockResolvedValue({ status: "supported" });

    resolveGatewayInstallTokenMock.mockResolvedValue({
      warnings: [],
    });
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: { exists: true, valid: true, sourceConfig: {}, config: {} },
      writeOptions: { expectedConfigPath: "/tmp/carapace.json" },
    });
    resolveCarapaceWrapperPathMock.mockResolvedValue("/usr/bin/carapace");
    formatGatewayServiceStartRepairIssuesMock.mockReturnValue(
      "service port does not match current gateway config",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      kind: "sealed",
      reason: "foreign-owner",
      artifact: "service-file",
      guidance: "deployment owner",
    },
    {
      kind: "unknown",
      reason: "unsafe-permissions",
      artifact: "service-directory",
      guidance: "chmod go-w",
    },
    {
      kind: "unknown",
      reason: "inspection-failed",
      artifact: "service-file",
      guidance: "Inspect service definition access",
    },
  ] as const)(
    "explains $reason without exposing raw details or doing config/token work",
    async ({ guidance, ...capability }) => {
      const install = vi.fn();
      const service = {
        install,
        isLoaded: vi.fn(async () => true),
        readDefinitionMutationCapability: vi.fn(async () => ({
          ...capability,
          detail: "repair-inspection-secret-canary",
        })),
      };
      const state: GatewayServiceState = {
        installed: true,
        loadState: { status: "loaded" },
        running: false,
        env: { HOME: "/home/carapace" },
        command: {
          programArguments: ["/usr/bin/carapace", "gateway"],
          environment: { HOME: "/home/carapace" },
        },
      };
      const params = {
        service,
        state,
        issues: [{ code: "missing-program" as const, message: "missing" }],
        json: true,
        stdout: process.stdout,
      };
      for (const action of ["start", "restart"] as const) {
        const repair =
          action === "restart"
            ? repairLoadedGatewayServiceForStart({ ...params, action })
            : repairLoadedGatewayServiceForStart(params);
        await expect(repair).rejects.toThrow(`SERVICE_DEFINITION_${capability.kind.toUpperCase()}`);
        await expect(repair).rejects.toThrow(guidance);
        await expect(repair).rejects.not.toThrow("secret-canary");
      }
      expect(readConfigFileSnapshotForWriteMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
    },
  );

  it("preserves the managed base environment when an environment-only drop-in overrides it", async () => {
    const installMock = vi.fn(async () => {});
    const isLoadedMock = vi.fn(async () => true);
    const service = {
      install: installMock,
      isLoaded: isLoadedMock,
    };
    const existingEnvironment = {
      HOME: "/home/carapace",
      CARAPACE_SERVICE_VERSION: "2026.4.24",
      CARAPACE_WRAPPER: "/usr/bin/carapace",
      TELEGRAM_DEFAULT_BOTTOKEN: "existing-env-file-token",
    };
    const existingEnvironmentValueSources = {
      CARAPACE_SERVICE_VERSION: "inline" as const,
      TELEGRAM_DEFAULT_BOTTOKEN: "file" as const,
    };
    const programArguments = [
      "/usr/bin/node",
      "--max-old-space-size=24576",
      "--require=/tmp/service-preload.js",
      "/usr/local/bin/carapace",
      "gateway",
    ];
    const state: GatewayServiceState = {
      installed: true,
      loadState: { status: "loaded" },
      running: false,
      env: {},
      command: {
        programArguments,
        environment: {
          ...existingEnvironment,
          CARAPACE_WRAPPER: "/srv/operator/carapace",
          OPERATOR_DROPIN_ONLY: "operator-owned",
          NODE_OPTIONS: "--max-old-space-size=512",
          TELEGRAM_DEFAULT_BOTTOKEN: "operator-drop-in-token",
        },
        environmentValueSources: {
          ...existingEnvironmentValueSources,
          TELEGRAM_DEFAULT_BOTTOKEN: "inline",
        },
        managedDefinition: {
          programArguments,
          environment: existingEnvironment,
          environmentValueSources: existingEnvironmentValueSources,
        },
        managedOverrides: { environment: { keys: ["NODE_OPTIONS"] } },
      },
    };

    await repairLoadedGatewayServiceForStart({
      service,
      state,
      issues: [{ code: "port-mismatch", message: "old port" }],
      json: true,
      stdout: process.stdout,
    });

    const planArg = readFirstInstallPlanArg();
    expect(planArg.existingCommand).toBe(state.command);
    expect(planArg.existingEnvironment).toBe(existingEnvironment);
    expect(planArg.existingEnvironmentValueSources).toBe(existingEnvironmentValueSources);
    expect(planArg.env).not.toHaveProperty("OPERATOR_DROPIN_ONLY");
    expect(resolveCarapaceWrapperPathMock).toHaveBeenCalledWith("/usr/bin/carapace");
    expect(installMock).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: { TELEGRAM_DEFAULT_BOTTOKEN: "existing-env-file-token" },
        environmentValueSources: { TELEGRAM_DEFAULT_BOTTOKEN: "file" },
      }),
    );
  });

  it.each([
    { status: "supported", expectedRuntime: "bun" },
    { status: "unsupported", expectedRuntime: "node" },
    { status: "probe-failed", expectedRuntime: null },
  ])(
    "repairs an installed Bun Gateway only when its probe result is known ($status)",
    async ({ status, expectedRuntime }) => {
      const error = new Error("Bun runtime probe failed (cwd /root): EACCES");
      resolveBunRuntimeInfoMock.mockResolvedValue({ status, error });
      const service = {
        install: vi.fn(async () => {}),
        isLoaded: vi.fn(async () => true),
      };
      const state: GatewayServiceState = {
        installed: true,
        loadState: { status: "loaded" },
        running: false,
        env: {},
        command: {
          programArguments: [
            "/home/carapace/.bun/bin/bun",
            "/usr/lib/carapace/dist/index.js",
            "gateway",
            "--port",
            "18789",
          ],
          environment: { HOME: "/home/carapace", CARAPACE_GATEWAY_PORT: "18789" },
        },
      };

      const repair = repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      });
      if (status === "probe-failed") {
        await expect(repair).rejects.toBe(error);
        expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
        expect(service.install).not.toHaveBeenCalled();
        return;
      }
      await repair;

      const plan = readFirstInstallPlanArg();
      expect(plan.runtime).toBe(expectedRuntime);
      expect(plan.runtimePath).toBe(
        expectedRuntime === "bun" ? "/home/carapace/.bun/bin/bun" : undefined,
      );
    },
  );

  it.each([
    ["command", { launcher: "command" as const }, undefined],
    ["working directory", { launcher: "working-directory" as const }, undefined],
    [
      "gateway target environment",
      { environment: { keys: ["CARAPACE_STATE_DIR"] } },
      { HOME: "/home/carapace", CARAPACE_STATE_DIR: "/srv/operator-state" },
    ],
  ])(
    "refuses an ineffective stopped-service repair for a %s drop-in",
    async (_, overrides, effectiveEnvironment) => {
      const installMock = vi.fn(async () => {});
      const service = { install: installMock, isLoaded: vi.fn(async () => true) };
      const managedDefinition = {
        programArguments: ["/usr/bin/carapace", "gateway", "run"],
        workingDirectory: "/srv/carapace",
        environment: { HOME: "/home/carapace" },
      };
      const state: GatewayServiceState = {
        installed: true,
        loadState: { status: "loaded" },
        running: false,
        env: {},
        command: {
          ...managedDefinition,
          ...(effectiveEnvironment ? { environment: effectiveEnvironment } : {}),
          sourcePath: "/home/carapace/.config/systemd/user/carapace-work.service",
          managedDefinition,
          managedOverrides: overrides,
        },
      };

      await expect(
        repairLoadedGatewayServiceForStart({
          service,
          state,
          issues: [{ code: "missing-program", message: "missing program" }],
          json: true,
          stdout: process.stdout,
        }),
      ).rejects.toThrow(/systemd drop-in.*systemctl --user cat carapace-work\.service/);

      expect(readConfigFileSnapshotForWriteMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
      expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
      expect(installMock).not.toHaveBeenCalled();
    },
  );

  it.each(["start", "restart"] as const)(
    "refuses %s repair when ambient state, config, and port target a different service",
    async (action) => {
      vi.stubEnv("CARAPACE_STATE_DIR", "/home/carapace/stress-state");
      vi.stubEnv("CARAPACE_CONFIG_PATH", "/home/carapace/stress-state/carapace.json");
      readConfigFileSnapshotForWriteMock.mockResolvedValue({
        snapshot: {
          exists: true,
          valid: true,
          sourceConfig: { gateway: { port: 18_999 } },
          config: { gateway: { port: 18_999 } },
        },
        writeOptions: { expectedConfigPath: "/home/carapace/stress-state/carapace.json" },
      });

      const originalUnit = [
        "ExecStart=/usr/bin/carapace gateway --port 18789",
        "EnvironmentFile=-/home/carapace/.carapace/gateway.systemd.env",
        "Environment=CARAPACE_SERVICE_MANAGED_ENV_KEYS=OPENAI_API_KEY,CARAPACE_GATEWAY_PASSWORD",
      ].join("\n");
      let unit = originalUnit;
      const installMock = vi.fn(async () => {
        unit = "rewritten";
      });
      const service = {
        install: installMock,
        isLoaded: vi.fn(async () => true),
      };
      const state: GatewayServiceState = {
        installed: true,
        loadState: { status: "loaded" },
        running: false,
        env: {},
        command: {
          programArguments: ["/usr/bin/carapace", "gateway", "--port", "18789"],
          environment: {
            HOME: "/home/carapace",
            OPENAI_API_KEY: "file-backed-openai-key",
            CARAPACE_GATEWAY_PASSWORD: "file-backed-password",
            CARAPACE_GATEWAY_PORT: "18789",
            CARAPACE_SERVICE_MANAGED_ENV_KEYS: "OPENAI_API_KEY,CARAPACE_GATEWAY_PASSWORD",
          },
          environmentValueSources: {
            HOME: "inline",
            OPENAI_API_KEY: "file",
            CARAPACE_GATEWAY_PASSWORD: "file",
            CARAPACE_GATEWAY_PORT: "inline",
            CARAPACE_SERVICE_MANAGED_ENV_KEYS: "inline",
          },
        },
      };

      const repairParams = {
        service,
        state,
        issues: [{ code: "port-mismatch" as const, message: "old port" }],
        json: true,
        stdout: process.stdout,
      };
      const repair =
        action === "restart"
          ? repairLoadedGatewayServiceForStart({ ...repairParams, action })
          : repairLoadedGatewayServiceForStart(repairParams);
      await expect(repair).rejects.toThrow(
        [
          "Refusing to repair the managed Gateway service because the current invocation targets a different Gateway:",
          '- CARAPACE_STATE_DIR: installed="/home/carapace/.carapace", ambient="/home/carapace/stress-state"',
          '- CARAPACE_CONFIG_PATH: installed="/home/carapace/.carapace/carapace.json", ambient="/home/carapace/stress-state/carapace.json"',
          '- gateway.port: installed="18789", ambient="18999"',
          `Run \`carapace gateway ${action}\` with the installed state directory, config path, and port (or unset conflicting environment overrides). To retarget intentionally, run \`carapace gateway install --force\`.`,
        ].join("\n"),
      );

      expect(unit).toBe(originalUnit);
      expect(installMock).not.toHaveBeenCalled();
      expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a port-less stale service repair when ambient port overrides its config port", async () => {
    vi.stubEnv("CARAPACE_GATEWAY_PORT", "18999");
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        sourceConfig: { gateway: { port: 18_789 } },
        config: { gateway: { port: 18_789 } },
      },
      writeOptions: { expectedConfigPath: "/home/carapace/.carapace/carapace.json" },
    });
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state: GatewayServiceState = {
      installed: true,
      loadState: { status: "loaded" },
      running: false,
      env: {},
      command: {
        programArguments: ["/usr/bin/carapace", "gateway"],
        environment: { HOME: "/home/carapace" },
      },
    };

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow('- gateway.port: installed="18789", ambient="18999"');

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it("resolves installed host-and-port environment syntax before comparing repair targets", async () => {
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state: GatewayServiceState = {
      installed: true,
      loadState: { status: "loaded" },
      running: false,
      env: {},
      command: {
        programArguments: ["/usr/bin/carapace", "gateway"],
        environment: {
          HOME: "/home/carapace",
          CARAPACE_GATEWAY_PORT: "127.0.0.1:19000",
        },
      },
    };

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow('- gateway.port: installed="19000", ambient="18789"');

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it("refuses repair when a legacy service does not identify its installed state directory", async () => {
    vi.stubEnv("HOME", "/home/ambient-user");
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state: GatewayServiceState = {
      installed: true,
      loadState: { status: "loaded" },
      running: false,
      env: {},
      command: {
        programArguments: ["/usr/bin/carapace", "gateway", "--port", "18789"],
        environment: { CARAPACE_GATEWAY_PORT: "18789" },
      },
    };

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "missing-program", message: "missing program" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow("installed state directory cannot be determined");

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it.each([
    { action: "start", probe: "throws" },
    { action: "restart", probe: "throws" },
    { action: "start", probe: "returns false" },
    { action: "restart", probe: "returns false" },
  ] as const)(
    "fails $action repair when the post-install probe $probe",
    async ({ action, probe }) => {
      const error = new Error("systemd show failed");
      const service = {
        install: vi.fn(async () => {}),
        isLoaded: vi.fn(async () => {
          if (probe === "throws") {
            throw error;
          }
          return false;
        }),
      };
      const state: GatewayServiceState = {
        installed: true,
        loadState: { status: "loaded" },
        running: false,
        env: {},
        command: {
          programArguments: ["/usr/bin/carapace", "gateway", "run"],
          environment: { HOME: "/home/carapace" },
        },
      };
      const params = {
        service,
        state,
        issues: [{ code: "port-mismatch" as const, message: "old port" }],
        json: true,
        stdout: process.stdout,
      };
      const repair =
        action === "restart"
          ? repairLoadedGatewayServiceForStart({ ...params, action })
          : repairLoadedGatewayServiceForStart(params);

      if (probe === "throws") {
        await expect(repair).rejects.toBe(error);
      } else {
        await expect(repair).rejects.toThrow("Gateway service is not loaded after repair.");
      }
      expect(service.install).toHaveBeenCalledTimes(1);
    },
  );
});
