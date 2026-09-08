// Qa Lab tests cover the SQLite-backed auth store plugin behavior.
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  loadAuthProfileStoreWithoutExternalProfiles,
  saveAuthProfileStore,
} from "carapace/plugin-sdk/agent-runtime";
import {
  closeCarapaceAgentDatabasesForTest,
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "carapace/plugin-sdk/sqlite-runtime-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirHarness } from "../../temp-dir.test-helper.js";
import { readQaAuthProfiles, writeQaAuthProfiles } from "./auth-store.js";
import { stageQaMockAuthProfiles } from "./mock-auth.js";

const tempDirs = createTempDirHarness();

async function createQaAuthState(prefix = "carapace-qa-auth-store-") {
  const stateDir = await tempDirs.makeTempDir(prefix);
  const agentId = "main";
  vi.stubEnv("CARAPACE_STATE_DIR", stateDir);
  return {
    agentDir: path.join(stateDir, "agents", agentId, "agent"),
    agentId,
    stateDir,
  };
}

describe("QA auth profile store", () => {
  afterEach(async () => {
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    vi.unstubAllEnvs();
    await tempDirs.cleanup();
  });

  it("keeps inherited host shared state unchanged while staging isolated profiles", async () => {
    const hostStateDir = await tempDirs.makeTempDir("carapace-qa-auth-host-state-");
    const qaStateDir = await tempDirs.makeTempDir("carapace-qa-auth-isolated-state-");
    const hostDatabase = openCarapaceStateDatabase({
      env: { ...process.env, CARAPACE_STATE_DIR: hostStateDir },
    });
    const hostDatabasePath = hostDatabase.path;
    closeCarapaceStateDatabaseForTest();
    const legacyHostDatabase = new DatabaseSync(hostDatabasePath);
    legacyHostDatabase.exec(`
      PRAGMA user_version = 6;
      UPDATE schema_meta SET schema_version = 6 WHERE meta_key = 'primary';
    `);
    legacyHostDatabase.close();
    vi.stubEnv("CARAPACE_STATE_DIR", hostStateDir);

    await writeQaAuthProfiles({
      agentId: "main",
      profiles: {
        "qa-mock-openai": {
          type: "api_key",
          provider: "openai",
          key: "qa-mock-not-a-real-key",
        },
      },
      stateDir: qaStateDir,
    });

    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    const preservedHostDatabase = new DatabaseSync(hostDatabasePath, { readOnly: true });
    expect(preservedHostDatabase.prepare("PRAGMA user_version").get()).toEqual({
      user_version: 6,
    });
    expect(
      preservedHostDatabase
        .prepare("SELECT schema_version FROM schema_meta WHERE meta_key = 'primary'")
        .get(),
    ).toEqual({ schema_version: 6 });
    preservedHostDatabase.close();
    vi.stubEnv("CARAPACE_STATE_DIR", qaStateDir);
    const qaAgentDir = path.join(qaStateDir, "agents", "main", "agent");
    expect(readQaAuthProfiles(qaAgentDir).profiles).toMatchObject({
      "qa-mock-openai": { provider: "openai" },
    });
  });

  it.each(["future", "invalid"] as const)(
    "stages concurrent isolated profiles and config without reading %s outer state",
    async (outerKind) => {
      const hostStateDir = await tempDirs.makeTempDir("carapace-qa-auth-unreadable-host-");
      const hostDatabasePath = path.join(hostStateDir, "state", "carapace.sqlite");
      await fs.mkdir(path.dirname(hostDatabasePath), { recursive: true });
      if (outerKind === "future") {
        const database = new DatabaseSync(hostDatabasePath);
        database.exec("PRAGMA user_version = 999");
        database.close();
      } else {
        await fs.writeFile(hostDatabasePath, "not a SQLite database");
      }
      const hostBefore = await fs.readFile(hostDatabasePath);
      const qaRoots = await Promise.all([
        tempDirs.makeTempDir("carapace-qa-auth-first-"),
        tempDirs.makeTempDir("carapace-qa-auth-second-"),
      ]);
      vi.stubEnv("CARAPACE_STATE_DIR", hostStateDir);
      vi.stubEnv("CARAPACE_AGENT_DIR", path.join(hostStateDir, "relocated-agent"));

      const configs = await Promise.all(
        qaRoots.map((stateDir, index) =>
          stageQaMockAuthProfiles({
            cfg: {},
            agentIds: ["qa"],
            stateDir,
            providers: [index === 0 ? "openai" : "anthropic"],
          }),
        ),
      );

      for (const [index, stateDir] of qaRoots.entries()) {
        const provider = index === 0 ? "openai" : "anthropic";
        const profileId = `qa-mock-${provider}`;
        const store = readQaAuthProfiles(path.join(stateDir, "agents", "qa", "agent"));
        expect(Object.keys(store.profiles)).toEqual([profileId]);
        expect(configs[index]?.auth).toEqual({
          profiles: {
            [profileId]: {
              provider,
              mode: "api_key",
              displayName: `QA mock ${provider} credential`,
            },
          },
        });
      }
      expect(await fs.readFile(hostDatabasePath)).toEqual(hostBefore);
      expect(process.env.CARAPACE_STATE_DIR).toBe(hostStateDir);
      expect(process.env.CARAPACE_AGENT_DIR).toBe(path.join(hostStateDir, "relocated-agent"));
    },
  );

  it.each(["future", "invalid"] as const)(
    "still refuses an explicit %s target auth database",
    async (targetKind) => {
      const { agentDir, agentId, stateDir } = await createQaAuthState();
      await fs.mkdir(agentDir, { recursive: true });
      const databasePath = path.join(agentDir, "carapace-agent.sqlite");
      if (targetKind === "future") {
        const database = new DatabaseSync(databasePath);
        database.exec("PRAGMA user_version = 999");
        database.close();
      } else {
        await fs.writeFile(databasePath, "not a SQLite database");
      }
      const before = await fs.readFile(databasePath);
      await expect(
        writeQaAuthProfiles({
          agentId,
          stateDir,
          profiles: {
            "qa-mock-openai": {
              type: "api_key",
              provider: "openai",
              key: "qa-mock-not-a-real-key",
            },
          },
        }),
      ).rejects.toThrow("unreadable");
      expect(await fs.readFile(databasePath)).toEqual(before);
    },
  );

  it("writes new auth profiles to SQLite without creating legacy JSON", async () => {
    const { agentDir, agentId, stateDir } = await createQaAuthState();

    await writeQaAuthProfiles({
      agentId,
      profiles: {
        "qa-mock-openai": {
          type: "api_key",
          provider: "openai",
          key: "qa-mock-not-a-real-key",
        },
      },
      stateDir,
    });

    expect(readQaAuthProfiles(agentDir).profiles["qa-mock-openai"]).toMatchObject({
      provider: "openai",
    });
    await expect(fs.stat(path.join(agentDir, "auth-profiles.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to bypass a pending legacy auth source", async () => {
    const { agentDir, agentId, stateDir } = await createQaAuthState();
    const authPath = path.join(agentDir, "auth-profiles.json");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(authPath, "{not-json", "utf8");

    await expect(
      writeQaAuthProfiles({
        agentId,
        profiles: {
          "qa-mock-openai": {
            type: "api_key",
            provider: "openai",
            key: "qa-mock-not-a-real-key",
          },
        },
        stateDir,
      }),
    ).rejects.toThrow("requires legacy credential migration");
    await expect(fs.readFile(authPath, "utf8")).resolves.toBe("{not-json");
  });

  it("merges canonical API-key, token, and OAuth profile shapes", async () => {
    const { agentDir, agentId, stateDir } = await createQaAuthState();
    await writeQaAuthProfiles({
      agentId,
      profiles: {
        existing: {
          type: "api_key",
          provider: "openai",
          keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        },
        tokenProfile: {
          type: "token",
          provider: "github",
          tokenRef: { source: "file", provider: "vault", id: "github/token" },
        },
        oauthProfile: {
          type: "oauth",
          provider: "chatgpt",
          access: "qa-access-token",
          refresh: "qa-refresh-token",
          expires: 1_900_000_000_000,
        },
      },
      stateDir,
    });

    await writeQaAuthProfiles({
      agentId,
      profiles: {
        "qa-mock-anthropic": {
          type: "api_key",
          provider: "anthropic",
          key: "qa-mock-not-a-real-key",
        },
      },
      stateDir,
    });

    expect(readQaAuthProfiles(agentDir).profiles).toMatchObject({
      existing: { type: "api_key", provider: "openai" },
      tokenProfile: { type: "token", provider: "github" },
      oauthProfile: { type: "oauth", provider: "chatgpt" },
      "qa-mock-anthropic": { type: "api_key", provider: "anthropic" },
    });
  });

  it("can replace an existing profile set for deterministic fixture seeding", async () => {
    const { agentDir, agentId, stateDir } = await createQaAuthState();
    vi.stubEnv("CARAPACE_STATE_DIR", stateDir);
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          stale: { type: "api_key", provider: "openai", key: "qa-stale-not-a-real-key" },
        },
        order: { openai: ["stale"] },
        lastGood: { openai: "stale" },
        usageStats: { stale: { cooldownUntil: Date.now() + 60_000 } },
      },
      agentDir,
      { filterExternalAuthProfiles: false, syncExternalCli: false },
    );

    await writeQaAuthProfiles({
      agentId,
      profiles: {
        current: { type: "api_key", provider: "anthropic", key: "qa-current-not-a-real-key" },
      },
      replace: true,
      stateDir,
    });

    expect(Object.keys(readQaAuthProfiles(agentDir).profiles)).toEqual(["current"]);
    const replaced = loadAuthProfileStoreWithoutExternalProfiles(agentDir, {
      inheritedAuthDir: agentDir,
    });
    expect(replaced.order).toBeUndefined();
    expect(replaced.lastGood).toBeUndefined();
    expect(replaced.usageStats).toBeUndefined();
  });
});
