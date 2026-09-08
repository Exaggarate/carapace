// Profile CLI tests cover profile selection, persistence, and command wiring.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayPort } from "../config/paths.js";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "carapace", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "carapace",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "carapace", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "carapace", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "carapace", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "carapace", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "status", "--deep"]);
  });

  it("preserves Matrix QA --profile for the command parser", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "matrix",
      "--profile",
      "fast",
      "--fail-fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "carapace",
      "qa",
      "matrix",
      "--profile",
      "fast",
      "--fail-fast",
    ]);
  });

  it("preserves Matrix QA --profile after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "--no-color",
      "qa",
      "matrix",
      "--profile=fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "carapace", "--no-color", "qa", "matrix", "--profile=fast"]);
  });

  it("parses qa run --profile smoke-ci as a root profile", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "run",
      "--profile",
      "smoke-ci",
      "--category",
      "agent-runtime.agent-turn-execution",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("smoke-ci");
    expect(res.argv).toEqual([
      "node",
      "carapace",
      "qa",
      "run",
      "--category",
      "agent-runtime.agent-turn-execution",
    ]);
  });

  it("parses qa run --profile=release self-check invocations as root profiles", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "run",
      "--profile=release",
      "--output",
      "qa-report.md",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("release");
    expect(res.argv).toEqual(["node", "carapace", "qa", "run", "--output", "qa-report.md"]);
  });

  it("preserves qa run --qa-profile for the command parser", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "run",
      "--qa-profile",
      "smoke-ci",
      "--surface",
      "agent-runtime",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "carapace",
      "qa",
      "run",
      "--qa-profile",
      "smoke-ci",
      "--surface",
      "agent-runtime",
    ]);
  });

  it("parses arbitrary qa run --profile values as root profiles", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "run",
      "--profile",
      "work",
      "--output",
      "qa-report.md",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "qa", "run", "--output", "qa-report.md"]);
  });

  it("parses arbitrary qa run --profile= values as root profiles", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "qa",
      "run",
      "--profile=work",
      "--output",
      "qa-report.md",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "qa", "run", "--output", "qa-report.md"]);
  });

  it("still parses root --profile before qa run", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "--profile",
      "work",
      "qa",
      "run",
      "--qa-profile",
      "smoke-ci",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "qa", "run", "--qa-profile", "smoke-ci"]);
  });

  it("still parses root --profile before Matrix QA", () => {
    const res = parseCliProfileArgs([
      "node",
      "carapace",
      "--profile",
      "work",
      "qa",
      "matrix",
      "--fail-fast",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "carapace", "qa", "matrix", "--fail-fast"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "carapace", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "carapace", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "carapace", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "carapace", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "carapace", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "carapace", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".carapace-dev");
    expect(env.CARAPACE_PROFILE).toBe("dev");
    expect(env.CARAPACE_STATE_DIR).toBe(expectedStateDir);
    expect(env.CARAPACE_CONFIG_PATH).toBe(path.join(expectedStateDir, "carapace.json"));
    expect(env.CARAPACE_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "prod",
      CARAPACE_STATE_DIR: "/custom",
      CARAPACE_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.CARAPACE_PROFILE).toBe("dev");
    expect(env.CARAPACE_STATE_DIR).toBe("/custom");
    expect(env.CARAPACE_GATEWAY_PORT).toBe("19099");
    expect(env.CARAPACE_CONFIG_PATH).toBe(path.join("/custom", "carapace.json"));
  });

  it.each([
    { name: "default service to named profile", inheritedProfile: undefined, selected: "work" },
    { name: "named service to different profile", inheritedProfile: "main", selected: "work" },
    { name: "named service to dev", inheritedProfile: "main", selected: "dev" },
  ])("replaces the complete service selector bundle: $name", ({ inheritedProfile, selected }) => {
    const inheritedStateDir = inheritedProfile
      ? `/home/peter/.carapace-${inheritedProfile}`
      : "/home/peter/.carapace";
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: inheritedProfile,
      CARAPACE_STATE_DIR: inheritedStateDir,
      CARAPACE_CONFIG_PATH: path.join(inheritedStateDir, "carapace.json"),
      CARAPACE_GATEWAY_PORT: "18789",
      CARAPACE_LAUNCHD_LABEL: inheritedProfile
        ? `ai.carapace.${inheritedProfile}`
        : "ai.carapace.gateway",
      CARAPACE_SYSTEMD_UNIT: inheritedProfile
        ? `carapace-gateway-${inheritedProfile}.service`
        : "carapace-gateway.service",
      CARAPACE_WINDOWS_TASK_NAME: inheritedProfile
        ? `Carapace Gateway (${inheritedProfile})`
        : "Carapace Gateway",
      CARAPACE_SERVICE_MARKER: "carapace",
      CARAPACE_SERVICE_KIND: "gateway",
    };

    applyCliProfileEnv({ profile: selected, env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_PROFILE).toBe(selected);
    expect(env.CARAPACE_STATE_DIR).toBe(`/home/peter/.carapace-${selected}`);
    expect(env.CARAPACE_CONFIG_PATH).toBeUndefined();
    expect(env.CARAPACE_GATEWAY_PORT).toBe(selected === "dev" ? "19001" : undefined);
    expect(env.CARAPACE_LAUNCHD_LABEL).toBeUndefined();
    expect(env.CARAPACE_SYSTEMD_UNIT).toBeUndefined();
    expect(env.CARAPACE_WINDOWS_TASK_NAME).toBeUndefined();
  });

  it("lets selected config or profile derivation resolve the port after stale service removal", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "main",
      CARAPACE_STATE_DIR: "/home/peter/.carapace-main",
      CARAPACE_CONFIG_PATH: "/home/peter/.carapace-main/carapace.json",
      CARAPACE_GATEWAY_PORT: "18789",
      CARAPACE_LAUNCHD_LABEL: "ai.carapace.main",
      CARAPACE_SYSTEMD_UNIT: "carapace-gateway-main.service",
      CARAPACE_WINDOWS_TASK_NAME: "Carapace Gateway (main)",
      CARAPACE_SERVICE_MARKER: "carapace",
      CARAPACE_SERVICE_KIND: "gateway",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(resolveGatewayPort({ gateway: { port: 21999 } }, env)).toBe(21999);
    expect(resolveGatewayPort(undefined, env)).not.toBe(18789);
  });

  it("supports legacy gateway services without a service kind", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "main",
      CARAPACE_STATE_DIR: "/home/peter/.carapace-main",
      CARAPACE_CONFIG_PATH: "/home/peter/.carapace-main/carapace.json",
      CARAPACE_GATEWAY_PORT: "18789",
      CARAPACE_SERVICE_MARKER: "carapace",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_CONFIG_PATH).toBeUndefined();
    expect(env.CARAPACE_GATEWAY_PORT).toBeUndefined();
  });

  it("preserves node service selectors when selecting a CLI profile", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "main",
      CARAPACE_STATE_DIR: "/home/peter/.carapace-main",
      CARAPACE_CONFIG_PATH: "/home/peter/.carapace-main/carapace.json",
      CARAPACE_GATEWAY_PORT: "19999",
      CARAPACE_LAUNCHD_LABEL: "ai.carapace.node",
      CARAPACE_SYSTEMD_UNIT: "carapace-node.service",
      CARAPACE_WINDOWS_TASK_NAME: "Carapace Node",
      CARAPACE_SERVICE_MARKER: "carapace",
      CARAPACE_SERVICE_KIND: "node",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_GATEWAY_PORT).toBe("19999");
    expect(env.CARAPACE_LAUNCHD_LABEL).toBe("ai.carapace.node");
    expect(env.CARAPACE_SYSTEMD_UNIT).toBe("carapace-node.service");
    expect(env.CARAPACE_WINDOWS_TASK_NAME).toBe("Carapace Node");
  });

  it.each([
    {
      name: "the default profile without a profile marker",
      inheritedProfile: undefined,
      inheritedStateDir: "/home/peter/.carapace",
    },
    {
      name: "the explicitly marked default profile",
      inheritedProfile: "default",
      inheritedStateDir: "/home/peter/.carapace",
    },
    {
      name: "another named profile",
      inheritedProfile: "main",
      inheritedStateDir: "/home/peter/.carapace-main",
    },
    {
      name: "a home-relative default state directory",
      inheritedProfile: undefined,
      inheritedStateDir: "~/.carapace",
    },
  ])(
    "switches inherited canonical state from $name to the requested profile",
    ({ inheritedProfile, inheritedStateDir }) => {
      const env: Record<string, string | undefined> = {
        CARAPACE_PROFILE: inheritedProfile,
        CARAPACE_STATE_DIR: inheritedStateDir,
        CARAPACE_CONFIG_PATH: path.join(inheritedStateDir, "carapace.json"),
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      const expectedStateDir = path.join(path.resolve("/home/peter"), ".carapace-work");
      expect(env.CARAPACE_PROFILE).toBe("work");
      expect(env.CARAPACE_STATE_DIR).toBe(expectedStateDir);
      expect(env.CARAPACE_CONFIG_PATH).toBe(path.join(expectedStateDir, "carapace.json"));
    },
  );

  it("preserves an explicit config outside inherited canonical profile state", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "main",
      CARAPACE_STATE_DIR: "/home/peter/.carapace-main",
      CARAPACE_CONFIG_PATH: "/srv/carapace/custom.json",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_STATE_DIR).toBe("/home/peter/.carapace-work");
    expect(env.CARAPACE_CONFIG_PATH).toBe("/srv/carapace/custom.json");
  });

  it.each(["carapace-gateway-main", "carapace-gateway-main.service"])(
    "drops inherited canonical service identities when switching profiles (%s)",
    (systemdUnit) => {
      const env: Record<string, string | undefined> = {
        CARAPACE_PROFILE: "main",
        CARAPACE_STATE_DIR: "/home/peter/.carapace-main",
        CARAPACE_CONFIG_PATH: "/home/peter/.carapace-main/carapace.json",
        CARAPACE_LAUNCHD_LABEL: "ai.carapace.main",
        CARAPACE_SYSTEMD_UNIT: systemdUnit,
        CARAPACE_WINDOWS_TASK_NAME: "Carapace Gateway (main)",
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      expect(env.CARAPACE_LAUNCHD_LABEL).toBeUndefined();
      expect(env.CARAPACE_SYSTEMD_UNIT).toBeUndefined();
      expect(env.CARAPACE_WINDOWS_TASK_NAME).toBeUndefined();
    },
  );

  it("preserves explicit custom service identities when switching profiles", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "main",
      CARAPACE_LAUNCHD_LABEL: "com.example.gateway",
      CARAPACE_SYSTEMD_UNIT: "custom-gateway.service",
      CARAPACE_WINDOWS_TASK_NAME: "Custom Gateway",
    };

    applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_LAUNCHD_LABEL).toBe("com.example.gateway");
    expect(env.CARAPACE_SYSTEMD_UNIT).toBe("custom-gateway.service");
    expect(env.CARAPACE_WINDOWS_TASK_NAME).toBe("Custom Gateway");
  });

  it.each([
    { inheritedProfile: "Main", selectedProfile: "main" },
    { inheritedProfile: "main", selectedProfile: "Main" },
  ])(
    "keeps case-distinct named profiles isolated ($inheritedProfile to $selectedProfile)",
    ({ inheritedProfile, selectedProfile }) => {
      const inheritedStateDir = `/home/peter/.carapace-${inheritedProfile}`;
      const env: Record<string, string | undefined> = {
        CARAPACE_PROFILE: inheritedProfile,
        CARAPACE_STATE_DIR: inheritedStateDir,
        CARAPACE_CONFIG_PATH: path.join(inheritedStateDir, "carapace.json"),
      };

      applyCliProfileEnv({ profile: selectedProfile, env, homedir: () => "/home/peter" });

      const expectedStateDir = `/home/peter/.carapace-${selectedProfile}`;
      expect(env.CARAPACE_PROFILE).toBe(selectedProfile);
      expect(env.CARAPACE_STATE_DIR).toBe(expectedStateDir);
      expect(env.CARAPACE_CONFIG_PATH).toBe(path.join(expectedStateDir, "carapace.json"));
    },
  );

  it("treats case variants of the default profile as the same canonical profile", () => {
    const stateDir = "/home/peter/.carapace";
    const env: Record<string, string | undefined> = {
      CARAPACE_PROFILE: "Default",
      CARAPACE_STATE_DIR: stateDir,
      CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
    };

    applyCliProfileEnv({ profile: "default", env, homedir: () => "/home/peter" });

    expect(env.CARAPACE_PROFILE).toBe("default");
    expect(env.CARAPACE_STATE_DIR).toBe(stateDir);
    expect(env.CARAPACE_CONFIG_PATH).toBe(path.join(stateDir, "carapace.json"));
  });

  it.each([
    {
      name: "the default profile",
      inheritedProfile: undefined,
      inheritedConfigPath: "/home/peter/.carapace/carapace.json",
    },
    {
      name: "another named profile",
      inheritedProfile: "main",
      inheritedConfigPath: "/home/peter/.carapace-main/carapace.json",
    },
    {
      name: "a home-relative named profile",
      inheritedProfile: "main",
      inheritedConfigPath: "~/.carapace-main/carapace.json",
    },
  ])(
    "switches an inherited $name config when the state directory is absent",
    ({ inheritedProfile, inheritedConfigPath }) => {
      const env: Record<string, string | undefined> = {
        CARAPACE_PROFILE: inheritedProfile,
        CARAPACE_CONFIG_PATH: inheritedConfigPath,
      };

      applyCliProfileEnv({ profile: "work", env, homedir: () => "/home/peter" });

      const expectedStateDir = "/home/peter/.carapace-work";
      expect(env.CARAPACE_PROFILE).toBe("work");
      expect(env.CARAPACE_STATE_DIR).toBe(expectedStateDir);
      expect(env.CARAPACE_CONFIG_PATH).toBe(path.join(expectedStateDir, "carapace.json"));
    },
  );

  it("uses CARAPACE_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      CARAPACE_HOME: "/srv/carapace-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/carapace-home");
    expect(env.CARAPACE_STATE_DIR).toBe(path.join(resolvedHome, ".carapace-work"));
    expect(env.CARAPACE_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".carapace-work", "carapace.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "carapace doctor --fix",
      env: {},
      expected: "carapace doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "carapace doctor --fix",
      env: { CARAPACE_PROFILE: "default" },
      expected: "carapace doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "carapace doctor --fix",
      env: { CARAPACE_PROFILE: "Default" },
      expected: "carapace doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "carapace doctor --fix",
      env: { CARAPACE_PROFILE: "bad profile" },
      expected: "carapace doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "carapace --profile work doctor --fix",
      env: { CARAPACE_PROFILE: "work" },
      expected: "carapace --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "carapace --dev doctor",
      env: { CARAPACE_PROFILE: "dev" },
      expected: "carapace --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("carapace doctor --fix", { CARAPACE_PROFILE: "work" })).toBe(
      "carapace --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("carapace doctor --fix", { CARAPACE_PROFILE: "  jbcarapace  " })).toBe(
      "carapace --profile jbcarapace doctor --fix",
    );
  });

  it("handles command with no args after carapace", () => {
    expect(formatCliCommand("carapace", { CARAPACE_PROFILE: "test" })).toBe(
      "carapace --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm carapace doctor", { CARAPACE_PROFILE: "work" })).toBe(
      "pnpm carapace --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("carapace gateway status --deep", { CARAPACE_CONTAINER_HINT: "demo" }),
    ).toBe("carapace --container demo gateway status --deep");
  });

  it("ignores unsafe container hints", () => {
    expect(
      formatCliCommand("carapace gateway status --deep", {
        CARAPACE_CONTAINER_HINT: "demo; rm -rf /",
      }),
    ).toBe("carapace gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("carapace doctor", {
        CARAPACE_CONTAINER_HINT: "demo",
        CARAPACE_PROFILE: "work",
      }),
    ).toBe("carapace --container demo doctor");
  });

  it.each([
    "carapace update",
    "pnpm carapace update --channel beta",
    "npm carapace update",
    "bunx carapace update",
    "npx carapace update",
    "carapace --profile work update",
    "carapace --profile=work update",
    "carapace --log-level debug update",
    "carapace --log-level=debug update",
    "carapace --dev update",
    "carapace --no-color update",
    "carapace --no-color --profile work --log-level=debug update",
    "carapace --profile update update",
    "pnpm carapace --profile work update --channel beta",
  ])("does not prepend --container to root update: %s", (command) => {
    expect(
      formatCliCommand(command, { CARAPACE_CONTAINER_HINT: "demo", CARAPACE_PROFILE: "work" }),
    ).toBe(command);
  });

  it.each([
    ["carapace", "plugins update telegram"],
    ["carapace", "hooks update webhook"],
    ["carapace", "skills update summarize"],
    ["pnpm carapace", "plugins update telegram"],
    ["carapace", "--profile work plugins update telegram"],
    ["carapace", "--log-level=debug plugins update telegram"],
    ["carapace", "--profile update plugins list"],
    ["carapace", "--log-level update plugins list"],
    ["carapace", "config set action update"],
    ["carapace", "gateway status --name update"],
  ])("preserves the active container for non-root update: %s %s", (prefix, command) => {
    expect(
      formatCliCommand(`${prefix} ${command}`, {
        CARAPACE_CONTAINER_HINT: "demo",
        CARAPACE_PROFILE: "work",
      }),
    ).toBe(`${prefix} --container demo ${command}`);
  });
});
