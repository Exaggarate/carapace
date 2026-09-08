// E2E tests for Docker setup script behavior and generated commands.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  cleanupDockerSetupSandboxRoot,
  collectMatchingLines,
  createDockerSetupSandbox,
  expectMissingPath,
  expectOfflineComposePolicy,
  findGatewayStartLineIndex,
  isGatewayStartLine,
  noFollowOwnershipRepair,
  prestartContainerEnvFlags,
  prestartSafePath,
  readDockerLog,
  readDockerLogLines,
  repoRoot,
  requireSandbox,
  resetDockerLog,
  resolveBashForCompatCheck,
  setupDockerSetupSandboxRoot,
  withUnixSocket,
  type DockerSetupSandbox,
} from "./docker-setup.e2e.test-support.js";

function createEnv(
  sandbox: DockerSetupSandbox,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
    HOME: process.env.HOME ?? sandbox.rootDir,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    DOCKER_STUB_LOG: sandbox.logPath,
    CARAPACE_GATEWAY_TOKEN: "test-token",
    CARAPACE_CONFIG_DIR: join(sandbox.rootDir, "config"),
    CARAPACE_WORKSPACE_DIR: join(sandbox.rootDir, "carapace"),
    CARAPACE_AUTH_PROFILE_SECRET_DIR: join(sandbox.rootDir, "auth-profile-secrets"),
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  return env;
}

function runDockerSetup(
  sandbox: DockerSetupSandbox,
  overrides: Record<string, string | undefined> = {},
  args: string[] = [],
) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.rootDir,
    env: createEnv(sandbox, overrides),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runDockerSetupWithUnsetGatewayToken(
  sandbox: DockerSetupSandbox,
  suffix: string,
  prepare?: (configDir: string) => Promise<void>,
) {
  const configDir = join(sandbox.rootDir, `config-${suffix}`);
  const workspaceDir = join(sandbox.rootDir, `workspace-${suffix}`);
  await mkdir(configDir, { recursive: true });
  await prepare?.(configDir);

  const result = runDockerSetup(sandbox, {
    CARAPACE_GATEWAY_TOKEN: undefined,
    CARAPACE_CONFIG_DIR: configDir,
    CARAPACE_WORKSPACE_DIR: workspaceDir,
  });
  const envFile = await readFile(join(sandbox.rootDir, ".env"), "utf8");

  return { result, envFile };
}

describe("scripts/docker/setup.sh", () => {
  let sandbox: DockerSetupSandbox | null = null;

  beforeAll(async () => {
    await setupDockerSetupSandboxRoot();
    sandbox = await createDockerSetupSandbox();
  });

  afterAll(async () => {
    if (!sandbox) {
      await cleanupDockerSetupSandboxRoot();
      return;
    }
    await rm(sandbox.rootDir, { recursive: true, force: true });
    await cleanupDockerSetupSandboxRoot();
    sandbox = null;
  });

  it("handles env defaults, home-volume mounts, and Docker build args", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const buildCommit = "0123456789abcdef0123456789abcdef01234567";

    const result = runDockerSetup(activeSandbox, {
      GIT_COMMIT: buildCommit,
      CARAPACE_DOCKER_APT_PACKAGES: "curl wget",
      CARAPACE_EXTRA_MOUNTS: undefined,
      CARAPACE_HOME_VOLUME: "carapace-home",
    });
    expect(result.status).toBe(0);
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_IMAGE_APT_PACKAGES=curl wget");
    expect(envFile).toContain("CARAPACE_DOCKER_BUILD_NODE_OPTIONS=--max-old-space-size=8192");
    expect(envFile).toContain("CARAPACE_DOCKER_BUILD_TSDOWN_MAX_OLD_SPACE_MB=");
    expect(envFile).toContain("CARAPACE_DOCKER_BUILD_SKIP_DTS=1");
    expect(envFile).toContain("CARAPACE_EXTRA_MOUNTS=");
    expect(envFile).toContain("CARAPACE_HOME_VOLUME=carapace-home"); // pragma: allowlist secret
    expect(envFile).toContain("CARAPACE_DISABLE_BONJOUR=");
    expect(envFile).toContain(
      `CARAPACE_AUTH_PROFILE_SECRET_DIR=${join(activeSandbox.rootDir, "auth-profile-secrets")}`,
    );
    const extraCompose = await readFile(
      join(activeSandbox.rootDir, "docker-compose.extra.yml"),
      "utf8",
    );
    expect(extraCompose).toContain("carapace-home:/home/node");
    expect(extraCompose).toContain(
      `${join(activeSandbox.rootDir, "auth-profile-secrets")}:/home/node/.config/carapace`,
    );
    expect(extraCompose).toContain("volumes:");
    expect(extraCompose).toContain("carapace-home:");
    const log = await readDockerLog(activeSandbox);
    expect(log).toContain("--build-arg CARAPACE_IMAGE_APT_PACKAGES=curl wget");
    expect(log).toContain(
      "--build-arg CARAPACE_DOCKER_BUILD_NODE_OPTIONS=--max-old-space-size=8192",
    );
    expect(log).toContain("--build-arg CARAPACE_DOCKER_BUILD_TSDOWN_MAX_OLD_SPACE_MB=");
    expect(log).toContain("--build-arg CARAPACE_DOCKER_BUILD_SKIP_DTS=1");
    expect(log).toMatch(
      /--build-arg CARAPACE_BUILD_TIMESTAMP=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/u,
    );
    expect(log).toContain(`--build-arg GIT_COMMIT=${buildCommit}`);
    expect(log).toContain(
      `run --rm --no-deps ${prestartContainerEnvFlags} --entrypoint node carapace-gateway dist/index.js onboard --mode local --no-install-daemon --gateway-auth token --gateway-token-ref-env CARAPACE_GATEWAY_TOKEN --skip-ui --suppress-gateway-token-output`,
    );
    expect(result.stdout).toContain("Gateway token: stored in Docker environment/config");
    expect(result.stdout).toContain("Gateway running with host port mapping.");
    expect(result.stdout).toContain("Access from tailnet devices via the host's tailnet IP.");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("logs -f carapace-gateway");
    expect(result.stdout).toContain(
      `exec carapace-gateway sh -lc 'node dist/index.js gateway health --token "$CARAPACE_GATEWAY_TOKEN"'`,
    );
    expect(result.stdout).not.toContain("node dist/index.js health --token");
    expect(result.stdout).not.toContain("test-token");
    expect(result.stdout).not.toContain("#token=");
    expect(log).toContain(
      `run --rm --no-deps ${prestartContainerEnvFlags} --entrypoint node carapace-gateway dist/index.js config set --batch-json [{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"},{"path":"gateway.controlUi.allowedOrigins","value":["http://localhost:18789","http://127.0.0.1:18789"]}]`,
    );
    expect(log).not.toContain("run --rm carapace-cli onboard --mode local --no-install-daemon");
  });

  it("allows ordinary spaces in host persistence paths and quotes generated mounts", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);
    const configDir = join(activeSandbox.rootDir, "config with spaces");
    const workspaceDir = join(activeSandbox.rootDir, "workspace with spaces");
    const authProfileSecretDir = join(activeSandbox.rootDir, "auth secrets with spaces");
    const homeVolumeDir = join(activeSandbox.rootDir, "home volume with spaces");
    const extraMountSource = join(activeSandbox.rootDir, "extra data");

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_CONFIG_DIR: configDir,
      CARAPACE_WORKSPACE_DIR: workspaceDir,
      CARAPACE_AUTH_PROFILE_SECRET_DIR: authProfileSecretDir,
      CARAPACE_HOME_VOLUME: homeVolumeDir,
      CARAPACE_EXTRA_MOUNTS: `${extraMountSource}:/mnt/extra data:ro`,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("cannot contain whitespace");
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain(`CARAPACE_CONFIG_DIR=${configDir}`);
    expect(envFile).toContain(`CARAPACE_WORKSPACE_DIR=${workspaceDir}`);
    expect(envFile).toContain(`CARAPACE_AUTH_PROFILE_SECRET_DIR=${authProfileSecretDir}`);

    const extraCompose = await readFile(
      join(activeSandbox.rootDir, "docker-compose.extra.yml"),
      "utf8",
    );
    expect(extraCompose).toContain(`"${homeVolumeDir}:/home/node"`);
    expect(extraCompose).toContain(`"${configDir}:/home/node/.carapace"`);
    expect(extraCompose).toContain(`"${workspaceDir}:/home/node/.carapace/workspace"`);
    expect(extraCompose).toContain(`"${authProfileSecretDir}:/home/node/.config/carapace"`);
    expect(extraCompose).toContain(`"${extraMountSource}:/mnt/extra data:ro"`);
  });

  it("persists explicit Docker Bonjour opt-in overrides", async () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_DISABLE_BONJOUR: "0",
    });

    expect(result.status).toBe(0);
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_DISABLE_BONJOUR=0");
  });

  it("persists and forwards signal-specific OTLP protocol overrides", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const protocolEnv = {
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/protobuf",
    };

    const result = runDockerSetup(activeSandbox, protocolEnv);

    expect(result.status).toBe(0);
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    for (const [key, value] of Object.entries(protocolEnv)) {
      expect(envFile).toContain(`${key}=${value}`);
      expect(compose).toContain(`${key}: \${${key}:-}`);
    }
  });

  it("normalizes legacy CARAPACE_DOCKER_APT_PACKAGES into CARAPACE_IMAGE_APT_PACKAGES", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_DOCKER_APT_PACKAGES: "curl wget",
    });
    expect(result.status).toBe(0);

    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_IMAGE_APT_PACKAGES=curl wget");
    expect(envFile).not.toContain("CARAPACE_DOCKER_APT_PACKAGES");

    const log = await readDockerLog(activeSandbox);
    expect(log).toContain("--build-arg CARAPACE_IMAGE_APT_PACKAGES=curl wget");
    expect(log).not.toContain("--build-arg CARAPACE_DOCKER_APT_PACKAGES");
  });

  it("prefers CARAPACE_IMAGE_APT_PACKAGES over legacy CARAPACE_DOCKER_APT_PACKAGES", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_IMAGE_APT_PACKAGES: "curl wget httpie",
      CARAPACE_DOCKER_APT_PACKAGES: "curl wget",
    });
    expect(result.status).toBe(0);

    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_IMAGE_APT_PACKAGES=curl wget httpie");
    expect(envFile).not.toContain("CARAPACE_DOCKER_APT_PACKAGES");

    const log = await readDockerLog(activeSandbox);
    expect(log).toContain("--build-arg CARAPACE_IMAGE_APT_PACKAGES=curl wget httpie");
    expect(log).not.toMatch(/--build-arg CARAPACE_IMAGE_APT_PACKAGES=curl wget(?! httpie)/);
  });

  it("explicitly empty CARAPACE_IMAGE_APT_PACKAGES suppresses legacy fallback", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_IMAGE_APT_PACKAGES: "",
      CARAPACE_DOCKER_APT_PACKAGES: "curl wget",
    });
    expect(result.status).toBe(0);

    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_IMAGE_APT_PACKAGES=");
    expect(envFile).not.toContain("curl wget");

    const log = await readDockerLog(activeSandbox);
    expect(log).not.toContain("--build-arg CARAPACE_IMAGE_APT_PACKAGES=curl wget");
  });

  it("avoids shared-network carapace-cli before the gateway is started", async () => {
    const activeSandbox = requireSandbox(sandbox);

    await resetDockerLog(activeSandbox);
    const result = runDockerSetup(activeSandbox);
    expect(result.status).toBe(0);

    const lines = await readDockerLogLines(activeSandbox);
    const gatewayStartIdx = findGatewayStartLineIndex(lines);
    expect(gatewayStartIdx).toBeGreaterThanOrEqual(0);

    const prestartLines = lines.slice(0, gatewayStartIdx);
    const prestartCliRunLines = collectMatchingLines(prestartLines, (line) =>
      /\bcompose\b.*\brun\b.*\bcarapace-cli\b/.test(line),
    );
    expect(prestartCliRunLines).toStrictEqual([]);
  });

  it("pins setup-time CLI state paths inside the container", async () => {
    const activeSandbox = requireSandbox(sandbox);

    await resetDockerLog(activeSandbox);
    const result = runDockerSetup(activeSandbox, {
      CARAPACE_HOME: "/mnt/c/Users/Trevor",
      CARAPACE_STATE_DIR: "/mnt/c/Users/Trevor/.carapace",
      CARAPACE_CONFIG_PATH: "/mnt/c/Users/Trevor/.carapace/carapace.json",
      CARAPACE_SKIP_ONBOARDING: "1",
    });
    expect(result.status).toBe(0);

    const lines = await readDockerLogLines(activeSandbox);
    const gatewayStartIdx = findGatewayStartLineIndex(lines);
    expect(gatewayStartIdx).toBeGreaterThanOrEqual(0);

    const prestartConfigLines = collectMatchingLines(lines.slice(0, gatewayStartIdx), (line) =>
      line.includes(" dist/index.js config "),
    );
    expect(prestartConfigLines.length).toBeGreaterThan(0);
    for (const line of prestartConfigLines) {
      expect(line).toContain(prestartContainerEnvFlags);
      expect(line).not.toContain("/mnt/c");
    }
  });

  it("forces BuildKit for local and sandbox docker builds", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await mkdir(join(activeSandbox.rootDir, "scripts", "docker", "sandbox"), { recursive: true });
    await writeFile(
      join(activeSandbox.rootDir, "scripts", "docker", "sandbox", "Dockerfile"),
      "FROM scratch\n",
    );
    await resetDockerLog(activeSandbox);
    const socketPath = join(activeSandbox.rootDir, "buildkit.sock");

    await withUnixSocket(socketPath, async () => {
      const result = runDockerSetup(activeSandbox, {
        CARAPACE_SANDBOX: "1",
        CARAPACE_DOCKER_SOCKET: socketPath,
      });

      expect(result.status).toBe(0);
      const buildLines = collectMatchingLines(await readDockerLogLines(activeSandbox), (line) =>
        line.startsWith("build "),
      );
      expect(buildLines.length).toBeGreaterThanOrEqual(2);
      const buildLinesWithoutBuildKit = collectMatchingLines(
        buildLines,
        (line) => !line.includes("DOCKER_BUILDKIT=1"),
      );
      expect(buildLinesWithoutBuildKit).toStrictEqual([]);
    });
  });

  it("offline mode reuses a preloaded local image without build or pull", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(
      activeSandbox,
      {
        CARAPACE_IMAGE: "ghcr.io/carapace/carapace:latest",
        CARAPACE_SKIP_ONBOARDING: "1",
      },
      ["--offline"],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Using preloaded Docker image: ghcr.io/carapace/carapace:latest",
    );

    const lines = await readDockerLogLines(activeSandbox);
    const log = lines.join("\n");
    expect(log).toContain("image inspect ghcr.io/carapace/carapace:latest");
    expect(log).not.toMatch(/^build /m);
    expect(log).not.toMatch(/^pull /m);
    expect(log).toContain("config set --batch-json");
    expectOfflineComposePolicy(lines);
  });

  it("offline mode fails before setup when the main image is missing", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(
      activeSandbox,
      {
        CARAPACE_IMAGE: "ghcr.io/carapace/carapace:offline",
        DOCKER_STUB_MISSING_IMAGES: "ghcr.io/carapace/carapace:offline",
      },
      ["--offline"],
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Offline Docker setup requires preloaded image ghcr.io/carapace/carapace:offline",
    );

    const log = await readDockerLog(activeSandbox);
    expect(log).toContain("image inspect ghcr.io/carapace/carapace:offline");
    expect(log).not.toMatch(/^build /m);
    expect(log).not.toMatch(/^pull /m);
    expect(log).not.toContain("up -d carapace-gateway");
  });

  it("offline sandbox stays disabled when its configured image is missing", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await mkdir(join(activeSandbox.rootDir, "scripts", "docker", "sandbox"), { recursive: true });
    await writeFile(
      join(activeSandbox.rootDir, "scripts", "docker", "sandbox", "Dockerfile"),
      "FROM scratch\n",
    );
    await resetDockerLog(activeSandbox);
    const socketPath = join(activeSandbox.rootDir, "sb.sock");

    await withUnixSocket(socketPath, async () => {
      const defaultImage = "registry.example/carapace-sandbox:approved";
      const agentImage = " registry.example/carapace-sandbox:agent ";
      const result = runDockerSetup(
        activeSandbox,
        {
          CARAPACE_SANDBOX: "1",
          CARAPACE_SKIP_ONBOARDING: "1",
          CARAPACE_DOCKER_SOCKET: socketPath,
          DOCKER_STUB_AGENTS_JSON: JSON.stringify({
            defaults: { sandbox: { docker: { image: defaultImage } } },
            list: [{ id: "custom", sandbox: { docker: { image: agentImage } } }],
          }),
          DOCKER_STUB_MISSING_IMAGES: agentImage,
        },
        ["--offline"],
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("cannot use required sandbox images");
      expect(result.stderr).toContain(agentImage);
      expect(result.stderr).toContain(
        "Offline sandbox prerequisites are incomplete; sandbox configuration was not changed",
      );

      const lines = await readDockerLogLines(activeSandbox);
      const log = lines.join("\n");
      expect(log).toContain("image inspect carapace:local");
      expect(log).not.toContain(`image inspect ${defaultImage}`);
      expect(log).toContain(`image inspect ${agentImage} host=unix://${socketPath}`);
      expect(log).not.toContain("image inspect carapace-sandbox:bookworm-slim");
      expect(log).not.toMatch(/^build /m);
      expect(log).not.toMatch(/^pull /m);
      expect(log).not.toContain("config set agents.defaults.sandbox.mode off");
      expect(log).not.toContain("config set agents.defaults.sandbox.mode non-main");
      expectOfflineComposePolicy(lines, { gatewayStarts: false });
    });
  });

  it("offline sandbox validates only effective Docker and browser images", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);
    const socketPath = join(activeSandbox.rootDir, "eff.sock");

    await withUnixSocket(socketPath, async () => {
      const defaultImage = "registry.example/carapace-sandbox:default";
      const browserImage = "registry.example/carapace-sandbox-browser:default";
      const ignoredImages = [
        "registry.example/carapace-sandbox:ssh",
        "registry.example/carapace-sandbox:shared-agent",
        "registry.example/carapace-sandbox-browser:shared-agent",
        "registry.example/carapace-sandbox:off",
        "registry.example/carapace-sandbox-browser:denied",
      ];
      const result = runDockerSetup(
        activeSandbox,
        {
          CARAPACE_SANDBOX: "1",
          CARAPACE_SKIP_ONBOARDING: "1",
          CARAPACE_DOCKER_SOCKET: socketPath,
          DOCKER_STUB_AGENTS_JSON: JSON.stringify({
            defaults: {
              sandbox: {
                backend: "Docker",
                docker: { image: defaultImage },
                browser: { enabled: true, image: browserImage },
              },
            },
            list: [
              { id: "ssh", sandbox: { backend: "ssh", docker: { image: ignoredImages[0] } } },
              {
                id: "shared",
                sandbox: {
                  scope: "shared",
                  docker: { image: ignoredImages[1] },
                  browser: { image: ignoredImages[2] },
                },
              },
              { id: "off", sandbox: { mode: "off", docker: { image: ignoredImages[3] } } },
              {
                id: "browser-denied",
                sandbox: { browser: { enabled: true, image: ignoredImages[4] } },
                tools: { sandbox: { tools: { deny: ["browser"] } } },
              },
            ],
          }),
          DOCKER_STUB_SANDBOX_TOOLS_JSON: JSON.stringify({ alsoAllow: ["group:ui"] }),
          DOCKER_STUB_BROWSER_CONTRACT: "2026-05-12-cdp-relay-auth",
          DOCKER_STUB_MISSING_IMAGES: ignoredImages.join(","),
        },
        ["--offline"],
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`  - ${defaultImage}`);
      expect(result.stdout).toContain(`  - ${browserImage}`);

      const lines = await readDockerLogLines(activeSandbox);
      const log = lines.join("\n");
      expect(log).toContain(`image inspect ${defaultImage} host=unix://${socketPath}`);
      expect(log).toContain(`image inspect ${browserImage} host=unix://${socketPath}`);
      for (const image of ignoredImages) {
        expect(log).not.toContain(`image inspect ${image}`);
      }
      expect(log).toContain("config set agents.defaults.sandbox.mode non-main");
      expectOfflineComposePolicy(lines);
    });
  });

  it("offline sandbox rejects an incompatible browser image", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);
    const socketPath = join(activeSandbox.rootDir, "br.sock");

    await withUnixSocket(socketPath, async () => {
      const browserImage = "registry.example/carapace-sandbox-browser:stale";
      const result = runDockerSetup(
        activeSandbox,
        {
          CARAPACE_SANDBOX: "1",
          CARAPACE_SKIP_ONBOARDING: "1",
          CARAPACE_DOCKER_SOCKET: socketPath,
          DOCKER_STUB_AGENTS_JSON: JSON.stringify({
            defaults: { sandbox: { browser: { enabled: true, image: browserImage } } },
          }),
          DOCKER_STUB_SANDBOX_TOOLS_JSON: JSON.stringify({ alsoAllow: ["browser"] }),
          DOCKER_STUB_BROWSER_CONTRACT: "old-contract",
        },
        ["--offline"],
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `${browserImage} (browser contract=old-contract, expected=2026-05-12-cdp-relay-auth)`,
      );
      expect(result.stderr).toContain(
        "Offline sandbox prerequisites are incomplete; sandbox configuration was not changed",
      );

      const lines = await readDockerLogLines(activeSandbox);
      const log = lines.join("\n");
      expect(log).toContain(`image inspect ${browserImage} host=unix://${socketPath}`);
      expect(log).not.toContain("config set agents.defaults.sandbox.mode off");
      expect(log).not.toContain("config set agents.defaults.sandbox.mode non-main");
      expectOfflineComposePolicy(lines, { gatewayStarts: false });
    });
  });

  it("precreates config identity dir for CLI device auth writes", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const configDir = join(activeSandbox.rootDir, "config-identity");
    const workspaceDir = join(activeSandbox.rootDir, "workspace-identity");

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_CONFIG_DIR: configDir,
      CARAPACE_WORKSPACE_DIR: workspaceDir,
    });

    expect(result.status).toBe(0);
    const identityDirStat = await stat(join(configDir, "identity"));
    expect(identityDirStat.isDirectory()).toBe(true);
  });

  it("writes CARAPACE_TZ into .env when given a real IANA timezone", async () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_TZ: "Asia/Shanghai",
    });

    expect(result.status).toBe(0);
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_TZ=Asia/Shanghai");
  });

  it("precreates agent data dirs to avoid EACCES in container", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const configDir = join(activeSandbox.rootDir, "config-agent-dirs");
    const workspaceDir = join(configDir, "workspace");
    const stateFiles = [
      "identity/owned.txt",
      "agents/workspace/owned.txt",
      "workspace-archive/owned.txt",
    ];
    const workspaceFile = "workspace/project/user.txt";
    for (const relative of [...stateFiles, workspaceFile]) {
      const path = join(configDir, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "fixture");
    }
    expect((await stat(workspaceDir)).dev).toBe((await stat(configDir)).dev);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_CONFIG_DIR: configDir,
      CARAPACE_WORKSPACE_DIR: workspaceDir,
    });

    expect(result.status).toBe(0);
    const agentDirStat = await stat(join(configDir, "agents", "main", "agent"));
    expect(agentDirStat.isDirectory()).toBe(true);
    const sessionsDirStat = await stat(join(configDir, "agents", "main", "sessions"));
    expect(sessionsDirStat.isDirectory()).toBe(true);

    // Verify that a root-user chown step runs before setup.
    const log = await readDockerLog(activeSandbox);
    const chownIdx = log.indexOf("--user root");
    const safePathIdx = log.indexOf(`${prestartSafePath}; export PATH`);
    const stateRepair = log.match(/\/usr\/bin\/find -P \/home\/node\/\.carapace [^;]+/u)?.[0];
    if (!stateRepair) {
      throw new Error("Missing generated state ownership repair");
    }
    const stateRepairIdx = log.indexOf(stateRepair);
    const onboardIdx = log.indexOf("onboard");
    expect(chownIdx).toBeGreaterThanOrEqual(0);
    expect(safePathIdx).toBeGreaterThan(chownIdx);
    expect(stateRepairIdx).toBeGreaterThan(safePathIdx);
    expect(onboardIdx).toBeGreaterThan(chownIdx);
    expect(log).toContain("run --rm --no-deps --user root --entrypoint sh carapace-gateway -c");
    expect(log).toContain("/usr/bin/chown -h node:node /home/node/.config");
    expect(stateRepair).toContain("-execdir /usr/bin/chown -h node:node {} +");
    expect(log).toContain(noFollowOwnershipRepair("/home/node/.config/carapace"));
    expect(log).toContain("[ ! -L /home/node/.carapace/workspace/.carapace ]");
    expect(log).toContain(noFollowOwnershipRepair("/home/node/.carapace/workspace/.carapace"));
    expect(log).toContain("fi || true");
    expect(log).not.toContain("-type d -o -type f");
    expect(log).not.toContain("-exec chown");
    expect(log).not.toContain(" chown node:node");
    expect(log).not.toContain("chown -R node:node /home/node/.carapace/workspace/.carapace");

    // Execute the generated traversal, replacing only the ownership side effect.
    // Same-device workspace mounts are not excluded by find's -xdev option.
    const selection = stateRepair
      .replaceAll("/home/node/.carapace", '"$repair_root"')
      .replace(/-execdir \/usr\/bin\/chown -h node:node \{\} \+$/u, "-print");
    expect(selection).not.toContain("chown");
    const traversal = spawnSync(
      "bash",
      ["-c", 'repair_root="$(cd "$1" && pwd)"; ' + selection, "ownership-repair", configDir],
      { encoding: "utf8" },
    );
    expect(traversal.status, traversal.stderr).toBe(0);
    const selected = traversal.stdout.trim().split(/\r?\n/u);
    const selectedRoot = selected[0];
    expect(selectedRoot).toMatch(/\/config-agent-dirs$/u);
    for (const relative of stateFiles) {
      expect(selected).toContain(`${selectedRoot}/${relative}`);
    }
    expect(selected).toContain(`${selectedRoot}/workspace`);
    expect(selected).not.toContain(`${selectedRoot}/${workspaceFile}`);
  });

  it("precreates auth profile secret key dir outside the mounted state dir", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const configDir = join(activeSandbox.rootDir, "config-auth-profile-key");
    const workspaceDir = join(activeSandbox.rootDir, "workspace-auth-profile-key");
    const secretDir = join(activeSandbox.rootDir, "auth-profile-secret-key");

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_CONFIG_DIR: configDir,
      CARAPACE_WORKSPACE_DIR: workspaceDir,
      CARAPACE_AUTH_PROFILE_SECRET_DIR: secretDir,
    });

    expect(result.status).toBe(0);
    const secretDirStat = await stat(secretDir);
    expect(secretDirStat.isDirectory()).toBe(true);
    expect(secretDir.startsWith(`${configDir}/`)).toBe(false);

    const log = await readDockerLog(activeSandbox);
    expect(log).toContain(noFollowOwnershipRepair("/home/node/.config/carapace"));
  });

  it("reuses existing config token when CARAPACE_GATEWAY_TOKEN is unset", async () => {
    const activeSandbox = requireSandbox(sandbox);
    const { result, envFile } = await runDockerSetupWithUnsetGatewayToken(
      activeSandbox,
      "token-reuse",
      async (configDir) => {
        await writeFile(
          join(configDir, "carapace.json"),
          JSON.stringify({ gateway: { auth: { mode: "token", token: "config-token-123" } } }),
        );
      },
    );

    expect(result.status).toBe(0);
    expect(envFile).toContain("CARAPACE_GATEWAY_TOKEN=config-token-123"); // pragma: allowlist secret
  });

  it("reuses existing .env token when CARAPACE_GATEWAY_TOKEN and config token are unset", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await writeFile(
      join(activeSandbox.rootDir, ".env"),
      "CARAPACE_GATEWAY_TOKEN=dotenv-token-123\nCARAPACE_GATEWAY_PORT=18789\n", // pragma: allowlist secret
    );
    const { result, envFile } = await runDockerSetupWithUnsetGatewayToken(
      activeSandbox,
      "dotenv-token-reuse",
    );

    expect(result.status).toBe(0);
    expect(envFile).toContain("CARAPACE_GATEWAY_TOKEN=dotenv-token-123"); // pragma: allowlist secret
    expect(result.stderr).toBe("");
  });

  it("reuses the last non-empty .env token and strips CRLF without truncating '='", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await writeFile(
      join(activeSandbox.rootDir, ".env"),
      [
        "CARAPACE_GATEWAY_TOKEN=",
        "CARAPACE_GATEWAY_TOKEN=first-token",
        "CARAPACE_GATEWAY_TOKEN=last=token=value\r", // pragma: allowlist secret
      ].join("\n"),
    );
    const { result, envFile } = await runDockerSetupWithUnsetGatewayToken(
      activeSandbox,
      "dotenv-last-wins",
    );

    expect(result.status).toBe(0);
    expect(envFile).toContain("CARAPACE_GATEWAY_TOKEN=last=token=value"); // pragma: allowlist secret
    expect(envFile).not.toContain("CARAPACE_GATEWAY_TOKEN=first-token");
    expect(envFile).not.toContain("\r");
  });

  it("treats CARAPACE_SANDBOX=0 as disabled", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_SANDBOX: "0",
    });

    expect(result.status).toBe(0);
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_SANDBOX=");

    const log = await readDockerLog(activeSandbox);
    expect(log).toContain("--build-arg CARAPACE_INSTALL_DOCKER_CLI=");
    expect(log).not.toContain("--build-arg CARAPACE_INSTALL_DOCKER_CLI=1");
    expect(log).toContain("config set agents.defaults.sandbox.mode off");
  });

  it("resets stale sandbox mode and overlay when sandbox is not active", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);
    await writeFile(
      join(activeSandbox.rootDir, "docker-compose.sandbox.yml"),
      "services:\n  carapace-gateway:\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n",
    );
    const socketPath = join(activeSandbox.rootDir, "missing-cli.sock");

    await withUnixSocket(socketPath, async () => {
      const result = runDockerSetup(activeSandbox, {
        CARAPACE_SANDBOX: "1",
        CARAPACE_DOCKER_SOCKET: socketPath,
        DOCKER_STUB_FAIL_MATCH: "--entrypoint docker carapace-gateway --version",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Sandbox requires Docker CLI");
      const log = await readDockerLog(activeSandbox);
      expect(log).toContain("config set agents.defaults.sandbox.mode off");
      await expectMissingPath(join(activeSandbox.rootDir, "docker-compose.sandbox.yml"));
    });
  });

  it("keeps offline policy when sandbox config writes fail and the gateway rolls back", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);
    const socketPath = join(activeSandbox.rootDir, "sandbox.sock");

    await withUnixSocket(socketPath, async () => {
      const result = runDockerSetup(
        activeSandbox,
        {
          CARAPACE_SANDBOX: "1",
          CARAPACE_DOCKER_SOCKET: socketPath,
          DOCKER_STUB_FAIL_MATCH: "config set agents.defaults.sandbox.scope",
        },
        ["--offline"],
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("Failed to set agents.defaults.sandbox.scope");
      expect(result.stderr).toContain("Skipping gateway restart to avoid exposing Docker socket");

      const lines = await readDockerLogLines(activeSandbox);
      const log = lines.join("\n");
      const gatewayStarts = collectMatchingLines(lines, (line) => isGatewayStartLine(line));
      expect(gatewayStarts).toHaveLength(2);
      expect(log).toContain(
        "run --pull never --rm --no-deps carapace-cli config set agents.defaults.sandbox.mode non-main",
      );
      expect(log).toContain("config set agents.defaults.sandbox.mode off");
      const forceRecreateLine = log
        .split("\n")
        .find((line) => line.includes("--force-recreate carapace-gateway"));
      expect(forceRecreateLine).toBe(
        `compose compose -f ${join(activeSandbox.rootDir, "docker-compose.yml")} up -d --pull never --no-build --force-recreate carapace-gateway`,
      );
      expect(forceRecreateLine).not.toContain("docker-compose.sandbox.yml");
      expect(log).toContain(
        `image inspect carapace-sandbox:bookworm-slim host=unix://${socketPath}`,
      );
      expectOfflineComposePolicy(lines);
      await expectMissingPath(join(activeSandbox.rootDir, "docker-compose.sandbox.yml"));
    });
  });

  it("rejects injected multiline CARAPACE_EXTRA_MOUNTS values", () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_EXTRA_MOUNTS: "/tmp:/tmp\n  evil-service:\n    image: alpine",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CARAPACE_EXTRA_MOUNTS cannot contain control characters");
  });

  it("rejects invalid CARAPACE_EXTRA_MOUNTS mount format", () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_EXTRA_MOUNTS: "bad mount spec",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid mount format");
  });

  it("rejects invalid CARAPACE_HOME_VOLUME names", () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_HOME_VOLUME: "bad name",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CARAPACE_HOME_VOLUME must match");
  });

  it("rejects CARAPACE_TZ values that are unsupported by the runtime image", () => {
    const activeSandbox = requireSandbox(sandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_TZ: "Nope/Bad",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CARAPACE_TZ must be supported by carapace:local");
  });

  it("skips onboarding when CARAPACE_SKIP_ONBOARDING is set", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_SKIP_ONBOARDING: "1",
    });

    expect(result.status).toBe(0);
    const log = await readDockerLog(activeSandbox);
    expect(log).not.toContain("onboard");
    // Gateway defaults (config set) and control UI allowlist should still run.
    expect(log).toContain("config set --batch-json");
    expect(log).toContain('"path":"gateway.mode","value":"local"');
    expect(log).toContain('"path":"gateway.bind","value":"lan"');
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toContain("CARAPACE_SKIP_ONBOARDING=1");
  });

  it("treats CARAPACE_SKIP_ONBOARDING=0 as disabled and runs onboarding", async () => {
    const activeSandbox = requireSandbox(sandbox);
    await resetDockerLog(activeSandbox);

    const result = runDockerSetup(activeSandbox, {
      CARAPACE_SKIP_ONBOARDING: "0",
    });

    expect(result.status).toBe(0);
    const log = await readDockerLog(activeSandbox);
    expect(log).toContain(
      "onboard --mode local --no-install-daemon --gateway-auth token --gateway-token-ref-env CARAPACE_GATEWAY_TOKEN --skip-ui --suppress-gateway-token-output",
    );
    const envFile = await readFile(join(activeSandbox.rootDir, ".env"), "utf8");
    expect(envFile).toMatch(/CARAPACE_SKIP_ONBOARDING=\n/);
  });

  it("avoids associative arrays so the script remains Bash 3.2-compatible", async () => {
    const script = await readFile(join(repoRoot, "scripts", "docker", "setup.sh"), "utf8");
    expect(script).not.toMatch(/^\s*declare -A\b/m);

    const systemBash = resolveBashForCompatCheck();
    if (!systemBash) {
      return;
    }

    const assocCheck = spawnSync(systemBash, ["-c", "declare -A _t=()"], {
      encoding: "utf8",
    });
    if (assocCheck.status === 0 || assocCheck.status === null) {
      // Skip runtime check when system bash supports associative arrays
      // (not Bash 3.2) or when /bin/bash is unavailable (e.g. Windows).
      return;
    }

    const syntaxCheck = spawnSync(
      systemBash,
      ["-n", join(repoRoot, "scripts", "docker", "setup.sh")],
      {
        encoding: "utf8",
      },
    );

    expect(syntaxCheck.status).toBe(0);
    expect(syntaxCheck.stderr).not.toContain("declare: -A: invalid option");
  });

  it("keeps docker-compose gateway command in sync", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose).not.toContain("gateway-daemon");
    expect(compose).toContain('"gateway"');
  });

  it("keeps docker-compose gateway Bonjour advertising in auto mode by default", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(
      compose.match(/CARAPACE_DISABLE_BONJOUR: \$\{CARAPACE_DISABLE_BONJOUR:-\}/g),
    ).toHaveLength(1);
  });

  it("keeps docker-compose CLI network namespace settings in sync", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose).toContain('network_mode: "service:carapace-gateway"');
    expect(compose).toContain("depends_on:\n      - carapace-gateway");
  });

  it("keeps docker-compose gateway token env defaults aligned across services", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose.match(/CARAPACE_GATEWAY_TOKEN: \$\{CARAPACE_GATEWAY_TOKEN:-\}/g)).toHaveLength(
      2,
    );
  });

  it("keeps docker-compose auth profile secret key source durable outside state", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(
      compose.split(
        '"${CARAPACE_AUTH_PROFILE_SECRET_DIR:-${HOME:-/tmp}/.carapace-auth-profile-secrets}:/home/node/.config/carapace"',
      ),
    ).toHaveLength(3);
  });

  it("keeps docker-compose optional env files aligned across services", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose.match(/env_file:\n {6}- path: \.env\n {8}required: false/g)).toHaveLength(2);
  });

  it("keeps docker-compose timezone env defaults aligned across services", async () => {
    const compose = await readFile(join(repoRoot, "docker-compose.yml"), "utf8");
    expect(compose.match(/TZ: \$\{CARAPACE_TZ:-UTC\}/g)).toHaveLength(2);
  });

  it("isolates container paths and listener port from host .env values on both services", async () => {
    const { services } = parse(await readFile(join(repoRoot, "docker-compose.yml"), "utf8")) as {
      services: Record<
        "carapace-gateway" | "carapace-cli",
        {
          environment: Record<string, string>;
          command: string[];
          ports: string[];
        }
      >;
    };
    const gateway = services["carapace-gateway"];
    const listenerPort = gateway.command[gateway.command.indexOf("--port") + 1];
    expect(listenerPort).toBe("18789");
    expect(gateway.ports).toContain(`\${CARAPACE_GATEWAY_PORT:-18789}:${listenerPort}`);
    for (const name of ["carapace-gateway", "carapace-cli"] as const) {
      expect(services[name].environment, name).toMatchObject({
        CARAPACE_HOME: "/home/node",
        CARAPACE_STATE_DIR: "/home/node/.carapace",
        CARAPACE_CONFIG_PATH: "/home/node/.carapace/carapace.json",
        CARAPACE_CONFIG_DIR: "/home/node/.carapace",
        CARAPACE_WORKSPACE_DIR: "/home/node/.carapace/workspace",
        CARAPACE_GATEWAY_PORT: listenerPort,
      });
    }
  });

  it("Dockerfile ARG CARAPACE_IMAGE_APT_PACKAGES must not have a default value", async () => {
    // If the ARG has a default (e.g. ARG CARAPACE_IMAGE_APT_PACKAGES=""), Docker treats it as
    // "set" even when no --build-arg is passed. That breaks the RUN fallback expression
    // ${CARAPACE_IMAGE_APT_PACKAGES-$CARAPACE_DOCKER_APT_PACKAGES} because the variable is
    // never truly unset, so legacy-only callers using --build-arg CARAPACE_DOCKER_APT_PACKAGES
    // get nothing installed — a backward-compat regression.
    const dockerfile = await readFile(join(repoRoot, "Dockerfile"), "utf8");
    const argLine = dockerfile
      .split("\n")
      .find((line) => line.startsWith("ARG CARAPACE_IMAGE_APT_PACKAGES"));
    // Must be bare `ARG CARAPACE_IMAGE_APT_PACKAGES` with no default assignment
    expect(argLine).toBe("ARG CARAPACE_IMAGE_APT_PACKAGES");
  });
});
