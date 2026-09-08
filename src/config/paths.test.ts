// Covers config path resolution across env, home, and agent roots.
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveLegacyOAuthPath } from "../agents/auth-profiles/legacy-source-diagnostic.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  allowsProcessHomeSessionScan,
  CONFIG_PATH,
  DEFAULT_GATEWAY_PORT,
  isDefaultInstallIdentity,
  isDefaultStateDir,
  isNixMode,
  normalizeStateDirEnv,
  pinRuntimePaths,
  resolveNativeServiceProfileConflict,
  resolveDefaultConfigCandidates,
  resolveCanonicalConfigPath,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveGatewayPort,
  resolveIncludeRoots,
  resolveOAuthDir,
  resolveStateDir,
  STATE_DIR,
} from "./paths.js";

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("default state directory", () => {
  it("matches filesystem aliases of the default state directory", async () => {
    await withTestDir({ prefix: "carapace-default-state-" }, async (root) => {
      const home = path.join(root, "home");
      const defaultStateDir = path.join(home, ".carapace");
      const stateAlias = path.join(home, "state-alias");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.symlink(defaultStateDir, stateAlias, "dir");

      expect(isDefaultStateDir({ HOME: home, CARAPACE_STATE_DIR: stateAlias }, () => home)).toBe(
        true,
      );
    });
  });
});

describe("default install identity", () => {
  it("accepts default paths and equivalent explicit overrides", () => {
    const home = "/home/test";
    const stateDir = path.join(home, ".carapace");
    const configPath = path.join(stateDir, "carapace.json");

    expect(isDefaultInstallIdentity({ HOME: home }, () => home)).toBe(true);
    expect(allowsProcessHomeSessionScan({ HOME: home }, () => home)).toBe(true);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, CARAPACE_STATE_DIR: stateDir, CARAPACE_CONFIG_PATH: configPath },
        () => home,
      ),
    ).toBe(true);
  });

  it("preserves implicit legacy config discovery for the default profile", async () => {
    await withTestDir({ prefix: "carapace-default-install-legacy-config-" }, async (home) => {
      const stateDir = path.join(home, ".carapace");
      const legacyStateDir = path.join(home, ".clawdbot");
      const legacyConfigPath = path.join(legacyStateDir, "clawdbot.json");
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(legacyStateDir, { recursive: true });
      await fs.writeFile(legacyConfigPath, "{}");

      const env = { HOME: home };
      expect(resolveConfigPathCandidate(env, () => home)).toBe(legacyConfigPath);
      expect(isDefaultInstallIdentity(env, () => home)).toBe(true);
    });
  });

  it("rejects non-default state or config paths", () => {
    const home = "/home/test";

    expect(
      isDefaultInstallIdentity({ HOME: home, CARAPACE_STATE_DIR: "/tmp/copied-state" }, () => home),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, CARAPACE_CONFIG_PATH: "/tmp/copied-carapace.json" },
        () => home,
      ),
    ).toBe(false);
  });

  it("rejects process home overrides that relocate the implicit install", () => {
    const accountHome = "/home/test";
    const stateDir = path.join(accountHome, ".carapace");

    expect(isDefaultInstallIdentity({ HOME: "/tmp/copied-home" }, () => accountHome)).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          HOME: "/tmp/copied-home",
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          USERPROFILE: "/tmp/copied-home",
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("rejects installs relocated through CARAPACE_HOME", () => {
    const accountHome = "/home/test";
    const installHome = "/srv/carapace";
    const stateDir = path.join(installHome, ".carapace");

    expect(isDefaultInstallIdentity({ CARAPACE_HOME: installHome }, () => accountHome)).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          CARAPACE_HOME: installHome,
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          CARAPACE_HOME: installHome,
          CARAPACE_PROFILE: "work",
          CARAPACE_STATE_DIR: path.join(installHome, ".carapace-work"),
          CARAPACE_CONFIG_PATH: path.join(installHome, ".carapace-work", "carapace.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("accepts the canonical paths a named profile projects", async () => {
    await withTestDir({ prefix: "carapace-profile-install-" }, async (home) => {
      const defaultStateDir = path.join(home, ".carapace");
      const profileStateDir = path.join(home, ".carapace-work");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.writeFile(path.join(defaultStateDir, "carapace.json"), "{}");

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: "work",
            CARAPACE_STATE_DIR: profileStateDir,
            CARAPACE_CONFIG_PATH: path.join(profileStateDir, "carapace.json"),
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        allowsProcessHomeSessionScan(
          {
            HOME: home,
            CARAPACE_PROFILE: "work",
            CARAPACE_STATE_DIR: profileStateDir,
            CARAPACE_CONFIG_PATH: path.join(profileStateDir, "carapace.json"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: "work",
            CARAPACE_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(false);

      await fs.mkdir(profileStateDir, { recursive: true });
      await fs.writeFile(path.join(profileStateDir, "carapace.json"), "{}");
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: "work",
            CARAPACE_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: "work",
            CARAPACE_STATE_DIR: path.join(home, ".carapace-other"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: "default",
            CARAPACE_STATE_DIR: defaultStateDir,
          },
          () => home,
        ),
      ).toBe(true);
    });
  });

  it.each([
    {
      platform: "darwin" as const,
      envKey: "CARAPACE_LAUNCHD_LABEL",
      value: "ai.carapace.gateway",
    },
    {
      platform: "linux" as const,
      envKey: "CARAPACE_SYSTEMD_UNIT",
      value: "carapace-gateway.service",
    },
    {
      platform: "win32" as const,
      envKey: "CARAPACE_WINDOWS_TASK_NAME",
      value: "Carapace Gateway",
    },
  ])("rejects a named profile overriding $envKey on $platform", ({ platform, envKey, value }) => {
    const home = "/home/test";
    const stateDir = path.join(home, ".carapace-work");
    expect(
      isDefaultInstallIdentity(
        {
          HOME: home,
          CARAPACE_PROFILE: "work",
          CARAPACE_STATE_DIR: stateDir,
          CARAPACE_CONFIG_PATH: path.join(stateDir, "carapace.json"),
          [envKey]: value,
        },
        () => home,
        platform,
      ),
    ).toBe(false);
  });

  it.each(["../escape", "work/../../escape", "work\\..\\escape", "."])(
    "rejects invalid profile %j even when its derived paths match",
    (profile) => {
      const home = "/home/test";
      const profileStateDir = path.join(home, `.carapace-${profile}`);

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            CARAPACE_PROFILE: profile,
            CARAPACE_STATE_DIR: profileStateDir,
            CARAPACE_CONFIG_PATH: path.join(profileStateDir, "carapace.json"),
          },
          () => home,
        ),
      ).toBe(false);
    },
  );

  it.each(["gateway", "node"])(
    "rejects macOS profile %j because its LaunchAgent label is reserved",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it.each(["Main", "MAIN", "Work"])(
    "rejects mixed-case native service profile %j on case-insensitive platforms",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: profile }, "win32")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it("keeps lowercase native service profiles byte-compatible", () => {
    expect(resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: "main" }, "darwin")).toBeNull();
    expect(resolveNativeServiceProfileConflict({ CARAPACE_PROFILE: "main" }, "win32")).toBeNull();
  });
});

describe("oauth paths", () => {
  it("prefers CARAPACE_OAUTH_DIR over CARAPACE_STATE_DIR", () => {
    const env = {
      CARAPACE_OAUTH_DIR: "/custom/oauth",
      CARAPACE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from CARAPACE_STATE_DIR when unset", () => {
    const env = {
      CARAPACE_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("gateway port resolution", () => {
  it("prefers numeric env values over config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ CARAPACE_GATEWAY_PORT: "19001", CARAPACE_PROFILE: "work" }),
      ),
    ).toBe(19001);
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, envWith({ CARAPACE_PROFILE: "work" })),
    ).toBe(19002);
  });

  it.each([
    { profile: "ct2", expected: 45696 },
    { profile: "p1402", expected: 55636 },
    { profile: "p2380", expected: 55636 },
  ])("derives the byte-exact profile port for $profile", ({ profile, expected }) => {
    const port = resolveGatewayPort({}, envWith({ CARAPACE_PROFILE: profile }));
    expect(port).toBe(expected);
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(60000);
  });

  it.each([undefined, "default", "Default", "../escape"])(
    "keeps the default port for profile %j",
    (profile) => {
      expect(resolveGatewayPort({}, envWith({ CARAPACE_PROFILE: profile }))).toBe(
        DEFAULT_GATEWAY_PORT,
      );
    },
  );

  it("accepts Compose-style IPv4 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ CARAPACE_GATEWAY_PORT: "127.0.0.1:18789" }),
      ),
    ).toBe(18789);
  });

  it("accepts Compose-style IPv6 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ CARAPACE_GATEWAY_PORT: "[::1]:28789" }),
      ),
    ).toBe(28789);
  });

  it("ignores the legacy env name and falls back to config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ CLAWDBOT_GATEWAY_PORT: "127.0.0.1:18789" }),
      ),
    ).toBe(19002);
  });

  it("falls back to config when the Compose-style suffix is invalid", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19003 } },
        envWith({ CARAPACE_GATEWAY_PORT: "127.0.0.1:not-a-port" }),
      ),
    ).toBe(19003);
  });

  it("falls back to config when env ports exceed TCP bounds", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, envWith({ CARAPACE_GATEWAY_PORT: "65536" })),
    ).toBe(19003);
    expect(
      resolveGatewayPort(
        { gateway: { port: 19004 } },
        envWith({ CARAPACE_GATEWAY_PORT: "127.0.0.1:65536" }),
      ),
    ).toBe(19004);
    expect(
      resolveGatewayPort(
        { gateway: { port: 19005 } },
        envWith({ CARAPACE_GATEWAY_PORT: "[::1]:65536" }),
      ),
    ).toBe(19005);
  });

  it("falls back when malformed IPv6 inputs do not provide an explicit port", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, envWith({ CARAPACE_GATEWAY_PORT: "::1" })),
    ).toBe(19003);
    expect(resolveGatewayPort({}, envWith({ CARAPACE_GATEWAY_PORT: "2001:db8::1" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });

  it("falls back to the default port when env is invalid and config is unset", () => {
    expect(resolveGatewayPort({}, envWith({ CARAPACE_GATEWAY_PORT: "127.0.0.1:not-a-port" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("state + config path candidates", () => {
  function expectCarapaceHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.CARAPACE_HOME;
    if (!configuredHome) {
      throw new Error("CARAPACE_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".carapace"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".carapace", "carapace.json"));
  }

  it("uses CARAPACE_STATE_DIR when set", () => {
    const env = {
      CARAPACE_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("normalizes relative CARAPACE_STATE_DIR overrides to absolute paths", () => {
    const env = {
      CARAPACE_STATE_DIR: ".",
      CARAPACE_HOME: "/srv/carapace-home",
    } as NodeJS.ProcessEnv;

    normalizeStateDirEnv(env);

    expect(env.CARAPACE_STATE_DIR).toBe(path.resolve("."));
  });

  it("pins a relative state-dir override before later resolution", () => {
    const env = {
      CARAPACE_STATE_DIR: "relative-state",
      CARAPACE_HOME: "/srv/carapace-home",
    } as NodeJS.ProcessEnv;

    normalizeStateDirEnv(env);
    const normalized = env.CARAPACE_STATE_DIR;

    expect(normalized).toBe(path.resolve("relative-state"));
    expect(resolveStateDir(env, () => "/srv/other-home")).toBe(normalized);
  });

  it("re-pins exported runtime paths after startup environment selection", () => {
    const originalConfigPath = CONFIG_PATH;
    const originalNixMode = isNixMode;
    const originalStateDir = STATE_DIR;
    const selectedStateDir = path.resolve("/tmp/carapace-selected-runtime-state");
    const selectedConfigPath = path.join(selectedStateDir, "selected.json");
    try {
      const pinned = pinRuntimePaths({
        CARAPACE_CONFIG_PATH: selectedConfigPath,
        CARAPACE_NIX_MODE: "1",
        CARAPACE_STATE_DIR: selectedStateDir,
        CARAPACE_TEST_FAST: "1",
      });

      expect(pinned).toEqual({
        configPath: selectedConfigPath,
        stateDir: selectedStateDir,
      });
      expect(CONFIG_PATH).toBe(selectedConfigPath);
      expect(isNixMode).toBe(true);
      expect(STATE_DIR).toBe(selectedStateDir);
    } finally {
      pinRuntimePaths({
        CARAPACE_CONFIG_PATH: originalConfigPath,
        CARAPACE_NIX_MODE: originalNixMode ? "1" : undefined,
        CARAPACE_STATE_DIR: originalStateDir,
        CARAPACE_TEST_FAST: "1",
      });
    }
  });

  it("uses CARAPACE_HOME for default state/config locations", () => {
    const env = {
      CARAPACE_HOME: "/srv/carapace-home",
    } as NodeJS.ProcessEnv;
    expectCarapaceHomeDefaults(env);
  });

  it("prefers CARAPACE_HOME over HOME for default state/config locations", () => {
    const env = {
      CARAPACE_HOME: "/srv/carapace-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;
    expectCarapaceHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(resolvedHome, ".carapace", "carapace.json"),
      path.join(resolvedHome, ".carapace", "clawdbot.json"),
      path.join(resolvedHome, ".clawdbot", "carapace.json"),
      path.join(resolvedHome, ".clawdbot", "clawdbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.carapace when it exists and legacy dir is missing", async () => {
    await withTestDir({ prefix: "carapace-state-" }, async (root) => {
      const newDir = path.join(root, ".carapace");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("falls back to existing legacy state dir when ~/.carapace is missing", async () => {
    await withTestDir({ prefix: "carapace-state-legacy-" }, async (root) => {
      const legacyDir = path.join(root, ".clawdbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyDir);
    });
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    await withTestDir({ prefix: "carapace-config-" }, async (root) => {
      const legacyDir = path.join(root, ".carapace");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "carapace.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    });
  });

  it.each([
    { name: "candidate", resolve: resolveConfigPathCandidate },
    { name: "active", resolve: resolveConfigPath },
    { name: "canonical", resolve: resolveCanonicalConfigPath },
  ])("resolves explicit config selection in $name without filesystem discovery", ({ resolve }) => {
    const home = path.resolve("config-selection-home");
    const configPath = path.join(home, "selected.json");
    const exists = vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    try {
      expect(resolve({ HOME: home, CARAPACE_CONFIG_PATH: configPath })).toBe(configPath);
      expect(exists).not.toHaveBeenCalled();
    } finally {
      exists.mockRestore();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    await withTestDir({ prefix: "carapace-config-override-" }, async (root) => {
      const legacyDir = path.join(root, ".carapace");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "carapace.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { CARAPACE_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "carapace.json"));
    });
  });
});

describe("resolveIncludeRoots", () => {
  const HOME = path.parse(process.cwd()).root + "fakehome";

  it("returns an empty list when CARAPACE_INCLUDE_ROOTS is unset or blank", () => {
    expect(resolveIncludeRoots(envWith({}), () => HOME)).toStrictEqual([]);
    expect(resolveIncludeRoots(envWith({ CARAPACE_INCLUDE_ROOTS: "" }), () => HOME)).toStrictEqual(
      [],
    );
    expect(
      resolveIncludeRoots(envWith({ CARAPACE_INCLUDE_ROOTS: "   " }), () => HOME),
    ).toStrictEqual([]);
  });

  it("splits on the platform path delimiter and resolves each entry to an absolute path", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const b = path.resolve(path.parse(process.cwd()).root, "shared", "b");
    const env = envWith({ CARAPACE_INCLUDE_ROOTS: [a, b].join(path.delimiter) });
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a, b]);
  });

  it("expands a leading tilde in each entry using the resolved home dir", () => {
    const env = envWith({ CARAPACE_INCLUDE_ROOTS: "~/share/carapace" });
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([path.join(HOME, "share", "carapace")]);
  });

  it("drops empty entries and preserves de-duplicated order for repeated roots", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const env = envWith({
      CARAPACE_INCLUDE_ROOTS: ["", a, "  ", a].join(path.delimiter),
    });
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a]);
  });
});
