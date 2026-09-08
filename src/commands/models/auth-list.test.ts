// Model auth-list tests cover provider auth listing and output formatting.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../../agents/auth-profiles.js";
import type { CarapaceConfig } from "../../config/types.carapace.js";
import type { OutputRuntimeEnv } from "../../runtime.js";
import { modelsAuthListCommand } from "./auth-list.js";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(),
  externalCliDiscoveryForProviderAuth: vi.fn(() => ({ kind: "none" })),
  loadModelsConfig: vi.fn(),
  resolveAuthProfileDisplayLabel: vi.fn(({ profileId }: { profileId: string }) => profileId),
  resolveAuthStatePathForDisplay: vi.fn((agentDir: string) => `${agentDir}/carapace-agent.sqlite`),
  resolveModelsTargetAgent: vi.fn((_cfg: CarapaceConfig, rawAgentId?: string) => {
    const agentId = rawAgentId ?? "main";
    return { agentDir: `/tmp/carapace/agents/${agentId}`, agentId };
  }),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentDir: (_cfg: CarapaceConfig, agentId: string) => `/tmp/carapace/agents/${agentId}`,
  resolveDefaultAgentId: () => "main",
}));

vi.mock("../../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
  externalCliDiscoveryForProviderAuth: mocks.externalCliDiscoveryForProviderAuth,
  resolveAuthProfileDisplayLabel: mocks.resolveAuthProfileDisplayLabel,
  resolveAuthStatePathForDisplay: mocks.resolveAuthStatePathForDisplay,
}));

vi.mock("./load-config.js", () => ({
  loadModelsConfig: mocks.loadModelsConfig,
}));

vi.mock("./shared.js", () => ({
  resolveModelsTargetAgent: mocks.resolveModelsTargetAgent,
}));

function createRuntime(): OutputRuntimeEnv & { logs: string[]; jsonPayloads: unknown[] } {
  const logs: string[] = [];
  const jsonPayloads: unknown[] = [];
  return {
    logs,
    jsonPayloads,
    log: (...args: unknown[]) => {
      logs.push(args.map((value) => String(value)).join(" "));
    },
    error: vi.fn(),
    exit: vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }),
    writeStdout: vi.fn(),
    writeJson: (value: unknown) => {
      jsonPayloads.push(value);
    },
  };
}

describe("modelsAuthListCommand", () => {
  beforeEach(() => {
    mocks.loadModelsConfig.mockReset().mockResolvedValue({} as CarapaceConfig);
    mocks.ensureAuthProfileStore.mockReset();
    mocks.externalCliDiscoveryForProviderAuth.mockClear();
    mocks.resolveAuthProfileDisplayLabel.mockClear();
    mocks.resolveAuthStatePathForDisplay
      .mockReset()
      .mockImplementation((agentDir: string) => `${agentDir}/carapace-agent.sqlite`);
    mocks.resolveModelsTargetAgent.mockClear();
  });

  it("filters profiles by provider and redacts credential material in JSON output", async () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:user@example.com": {
          type: "oauth",
          provider: "openai",
          access: "access-secret",
          refresh: "refresh-secret",
          expires: 1_800_000_000_000,
          email: "user@example.com",
        },
        "anthropic:manual": {
          type: "token",
          provider: "anthropic",
          token: "token-secret",
        },
      },
      usageStats: {
        "openai:user@example.com": {
          cooldownUntil: 1_800_000_010_000,
        },
      },
    };
    mocks.ensureAuthProfileStore.mockReturnValue(store);
    const runtime = createRuntime();

    await modelsAuthListCommand({ provider: "OpenAI", agent: "coder", json: true }, runtime);

    expect(mocks.resolveModelsTargetAgent).toHaveBeenCalledWith(expect.anything(), "coder", {
      kind: "read",
    });
    expect(mocks.externalCliDiscoveryForProviderAuth).toHaveBeenCalledWith({
      cfg: {},
      provider: "openai",
    });
    expect(runtime.jsonPayloads).toStrictEqual([
      {
        agentDir: "/tmp/carapace/agents/coder",
        agentId: "coder",
        authStatePath: "/tmp/carapace/agents/coder/carapace-agent.sqlite",
        profiles: [
          {
            cooldownUntil: "2027-01-15T08:00:10.000Z",
            email: "user@example.com",
            expiresAt: "2027-01-15T08:00:00.000Z",
            id: "openai:user@example.com",
            label: "openai:user@example.com",
            provider: "openai",
            recoveryHint: "Wait for cooldown or switch provider.",
            type: "oauth",
          },
        ],
        provider: "openai",
      },
    ]);
    expect(JSON.stringify(runtime.jsonPayloads[0])).not.toContain("secret");
  });

  it("shows the cooldown reason and re-authentication action in text and JSON", async () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "anthropic:claude-cli": {
          type: "oauth",
          provider: "claude-cli",
          access: "secret",
          refresh: "secret",
          expires: 1_900_000_000_000,
        },
      },
      usageStats: {
        "anthropic:claude-cli": {
          cooldownUntil: 1_900_000_100_000,
          cooldownReason: "session_expired",
        },
      },
    } satisfies AuthProfileStore);

    const textRuntime = createRuntime();
    await modelsAuthListCommand({}, textRuntime);
    expect(textRuntime.logs.at(-1)).toContain("cooldown:session_expired");
    expect(textRuntime.logs.at(-1)).toContain(
      "claude auth login && carapace models auth login --provider anthropic --method cli",
    );

    const jsonRuntime = createRuntime();
    await modelsAuthListCommand({ json: true }, jsonRuntime);
    expect(jsonRuntime.jsonPayloads[0]).toMatchObject({
      profiles: [
        expect.objectContaining({
          id: "anthropic:claude-cli",
          cooldownReason: "session_expired",
          recoveryHint:
            "Re-authenticate with `claude auth login && carapace models auth login --provider anthropic --method cli --profile-id 'anthropic:claude-cli'`.",
        }),
      ],
    });
  });

  it("shows exact WHAM classification without hiding the canonical reason in JSON", async () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "openai:expired": {
          type: "oauth",
          provider: "openai",
          access: "secret",
          refresh: "secret",
          expires: 1_900_000_000_000,
        },
      },
      usageStats: {
        "openai:expired": {
          cooldownUntil: 1_900_000_100_000,
          cooldownReason: "auth",
          cooldownClassification: "wham_token_expired",
        },
      },
    } satisfies AuthProfileStore);

    const textRuntime = createRuntime();
    await modelsAuthListCommand({}, textRuntime);
    expect(textRuntime.logs.at(-1)).toContain("cooldown:wham_token_expired");

    const jsonRuntime = createRuntime();
    await modelsAuthListCommand({ json: true }, jsonRuntime);
    expect(jsonRuntime.jsonPayloads[0]).toMatchObject({
      profiles: [
        expect.objectContaining({
          cooldownReason: "auth",
          cooldownClassification: "wham_token_expired",
        }),
      ],
    });
  });

  it("routes legacy Gemini CLI cooldowns to supported Google API-key setup", async () => {
    mocks.ensureAuthProfileStore.mockReturnValue({
      version: 1,
      profiles: {
        "google-gemini-cli:legacy": {
          type: "oauth",
          provider: "google-gemini-cli",
          access: "secret",
          refresh: "secret",
          expires: 1_900_000_000_000,
        },
      },
      usageStats: {
        "google-gemini-cli:legacy": {
          cooldownUntil: 1_900_000_100_000,
          cooldownReason: "session_expired",
        },
      },
    } satisfies AuthProfileStore);

    const runtime = createRuntime();
    await modelsAuthListCommand({ json: true }, runtime);

    expect(runtime.jsonPayloads[0]).toMatchObject({
      profiles: [
        expect.objectContaining({
          id: "google-gemini-cli:legacy",
          recoveryHint: expect.stringContaining("--provider google`"),
        }),
      ],
    });
    expect(JSON.stringify(runtime.jsonPayloads[0])).not.toContain("--provider google-gemini-cli");
  });

  it("treats the OpenAI filter as the friendly view over API-key and OAuth profiles", async () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:user@example.com": {
          type: "oauth",
          provider: "openai",
          access: "access-secret",
          refresh: "refresh-secret",
          expires: 1_800_000_000_000,
          email: "user@example.com",
        },
        "openai:api-key-backup": {
          type: "api_key",
          provider: "openai",
          key: "sk-secret",
        },
        "anthropic:manual": {
          type: "token",
          provider: "anthropic",
          token: "token-secret",
        },
      },
    };
    mocks.ensureAuthProfileStore.mockReturnValue(store);
    const runtime = createRuntime();

    await modelsAuthListCommand({ provider: "OpenAI", json: true }, runtime);

    expect(mocks.externalCliDiscoveryForProviderAuth).toHaveBeenCalledWith({
      cfg: {},
      provider: "openai",
    });
    expect(runtime.jsonPayloads).toStrictEqual([
      {
        agentDir: "/tmp/carapace/agents/main",
        agentId: "main",
        authStatePath: "/tmp/carapace/agents/main/carapace-agent.sqlite",
        profiles: [
          {
            id: "openai:api-key-backup",
            label: "openai:api-key-backup",
            provider: "openai",
            type: "api_key",
          },
          {
            email: "user@example.com",
            expiresAt: "2027-01-15T08:00:00.000Z",
            id: "openai:user@example.com",
            label: "openai:user@example.com",
            provider: "openai",
            type: "oauth",
          },
        ],
        provider: "openai",
      },
    ]);
    expect(JSON.stringify(runtime.jsonPayloads[0])).not.toContain("secret");
  });

  it.each([
    ["agent-local", "/tmp/carapace/agents/main/carapace-agent.sqlite"],
    ["shared", "/tmp/carapace/state/carapace.sqlite"],
  ])("prints an empty profile list with the %s auth path", async (_shape, authStatePath) => {
    mocks.ensureAuthProfileStore.mockReturnValue({ version: 1, profiles: {} });
    mocks.resolveAuthStatePathForDisplay.mockReturnValue(authStatePath);
    const runtime = createRuntime();

    await modelsAuthListCommand({}, runtime);

    expect(runtime.logs).toEqual([
      "Agent: main",
      `Auth state store: ${authStatePath}`,
      "Profiles: (none)",
    ]);
  });

  it("omits Date-invalid auth timestamps without failing", async () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {
        "openai:user@example.com": {
          type: "oauth",
          provider: "openai",
          access: "access-secret",
          refresh: "refresh-secret",
          expires: 8_700_000_000_000_000,
          email: "user@example.com",
        },
      },
      usageStats: {
        "openai:user@example.com": {
          cooldownUntil: 8_700_000_000_000_000,
        },
      },
    };
    mocks.ensureAuthProfileStore.mockReturnValue(store);
    const runtime = createRuntime();

    await modelsAuthListCommand({ provider: "openai", json: true }, runtime);

    expect(runtime.jsonPayloads).toStrictEqual([
      {
        agentDir: "/tmp/carapace/agents/main",
        agentId: "main",
        authStatePath: "/tmp/carapace/agents/main/carapace-agent.sqlite",
        profiles: [
          {
            email: "user@example.com",
            id: "openai:user@example.com",
            label: "openai:user@example.com",
            provider: "openai",
            type: "oauth",
          },
        ],
        provider: "openai",
      },
    ]);
  });
});
