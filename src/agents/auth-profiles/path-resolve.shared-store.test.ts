import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { writeConfigMachineState } from "../../state/config-machine-state-write.js";
import { closeCarapaceStateDatabaseForTest } from "../../state/carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "../../state/carapace-state-db.paths.js";
import { withEnv } from "../../test-utils/env.js";
import { resolveAuthStatePathForDisplay, resolveAuthStorePathForDisplay } from "./paths.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  setRuntimeAuthProfileStoreSnapshot,
} from "./runtime-snapshots.js";
import { hasLocalAuthProfileStoreSource } from "./source-check.js";
import {
  inspectPersistedAuthProfileStoreRaw,
  writePersistedAuthProfileStoreRaw,
} from "./sqlite.js";
import type { AuthProfileStore } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const persistedStore = {
  version: 1,
  profiles: {
    "openai:test": { type: "api_key", provider: "openai", key: "test-key" },
  },
} satisfies AuthProfileStore;

function makeStateEnv(): NodeJS.ProcessEnv {
  const stateDir = tempDirs.make("carapace-shared-auth-store-");
  return { ...process.env, CARAPACE_STATE_DIR: stateDir, CARAPACE_AGENT_DIR: undefined };
}

describe("shared auth store path resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
    closeCarapaceStateDatabaseForTest();
  });

  it("keeps the absent ownership record pinned to the shipped legacy-main path", async () => {
    const env = makeStateEnv();
    const { resolveSharedAuthStorePath } = await import("./path-resolve.js");
    const { resolveSharedMainAuthAgentDir } = await import("./shared-main-dir.js");
    const legacyDir = resolveSharedMainAuthAgentDir(env);

    expect(resolveSharedAuthStorePath(env)).toBe(path.join(legacyDir, "carapace-agent.sqlite"));

    writeConfigMachineState("auth.sharedStore", { location: "state-db" }, { env });
    const aliasEnv = {
      ...env,
      CARAPACE_STATE_DIR: path.join(env.CARAPACE_STATE_DIR ?? "", "."),
    };

    expect(resolveSharedAuthStorePath(aliasEnv)).toBe(
      path.join(legacyDir, "carapace-agent.sqlite"),
    );

    withEnv({ CARAPACE_STATE_DIR: env.CARAPACE_STATE_DIR, CARAPACE_AGENT_DIR: undefined }, () => {
      writePersistedAuthProfileStoreRaw(persistedStore, legacyDir);
      const expectedPath = path.join(legacyDir, "carapace-agent.sqlite");
      expect(resolveAuthStorePathForDisplay(legacyDir)).toBe(expectedPath);
      expect(resolveAuthStatePathForDisplay(legacyDir)).toBe(expectedPath);
      expect(inspectPersistedAuthProfileStoreRaw(legacyDir)).toMatchObject({
        status: "readable",
        raw: persistedStore,
      });
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  it("reloads ownership after an explicit out-of-process auth mutation", async () => {
    const env = makeStateEnv();
    const {
      reloadSharedAuthStoreOwnership,
      resolveSharedAuthStoreOwnership,
      resolveSharedAuthStorePath,
    } = await import("./path-resolve.js");

    expect(resolveSharedAuthStoreOwnership(env)).toEqual({ location: "legacy-main" });
    writeConfigMachineState("auth.sharedStore", { location: "state-db" }, { env });
    expect(resolveSharedAuthStoreOwnership(env)).toEqual({ location: "legacy-main" });

    expect(reloadSharedAuthStoreOwnership(env)).toEqual({ location: "state-db" });
    expect(resolveSharedAuthStorePath(env)).toBe(resolveCarapaceStateSqlitePath(env));
  });

  it("resolves the relocated store to the canonical shared state database", async () => {
    const env = makeStateEnv();
    writeConfigMachineState("auth.sharedStore", { location: "state-db" }, { env });
    const { resolveSharedAuthStoreOwnership, resolveSharedAuthStorePath } =
      await import("./path-resolve.js");

    expect(resolveSharedAuthStoreOwnership(env)).toEqual({ location: "state-db" });
    expect(resolveSharedAuthStorePath(env)).toBe(resolveCarapaceStateSqlitePath(env));

    withEnv({ CARAPACE_STATE_DIR: env.CARAPACE_STATE_DIR, CARAPACE_AGENT_DIR: undefined }, () => {
      writePersistedAuthProfileStoreRaw(persistedStore);
      const agentDir = path.join(env.CARAPACE_STATE_DIR ?? "", "agents", "helper", "agent");
      const expectedPath = resolveCarapaceStateSqlitePath(env);
      expect(resolveAuthStorePathForDisplay(agentDir)).toBe(expectedPath);
      expect(resolveAuthStatePathForDisplay(agentDir)).toBe(expectedPath);
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  it("keeps an agent-local store local under shared-state ownership", async () => {
    const env = makeStateEnv();
    writeConfigMachineState("auth.sharedStore", { location: "state-db" }, { env });
    const agentDir = path.join(env.CARAPACE_STATE_DIR ?? "", "agents", "helper", "agent");

    withEnv({ CARAPACE_STATE_DIR: env.CARAPACE_STATE_DIR, CARAPACE_AGENT_DIR: undefined }, () => {
      writePersistedAuthProfileStoreRaw(persistedStore, agentDir);
      const expectedPath = path.join(agentDir, "carapace-agent.sqlite");
      expect(resolveAuthStorePathForDisplay(agentDir)).toBe(expectedPath);
      expect(resolveAuthStatePathForDisplay(agentDir)).toBe(expectedPath);
      expect(existsSync(expectedPath)).toBe(true);
    });
  });

  it("ignores runtime-only external CLI profiles when displaying store ownership", async () => {
    const env = makeStateEnv();
    writeConfigMachineState("auth.sharedStore", { location: "state-db" }, { env });
    const agentDir = path.join(env.CARAPACE_STATE_DIR ?? "", "agents", "helper", "agent");

    withEnv({ CARAPACE_STATE_DIR: env.CARAPACE_STATE_DIR, CARAPACE_AGENT_DIR: undefined }, () => {
      writePersistedAuthProfileStoreRaw(persistedStore);
      setRuntimeAuthProfileStoreSnapshot(
        {
          ...persistedStore,
          runtimeExternalProfileIds: ["openai:test"],
          runtimeExternalCliProfileIds: ["openai:test"],
        },
        agentDir,
      );

      expect(hasLocalAuthProfileStoreSource(agentDir)).toBe(true);
      expect(inspectPersistedAuthProfileStoreRaw(agentDir).status).toBe("missing");
      expect(resolveAuthStorePathForDisplay(agentDir)).toBe(resolveCarapaceStateSqlitePath(env));
      expect(resolveAuthStatePathForDisplay(agentDir)).toBe(resolveCarapaceStateSqlitePath(env));
    });
  });

  it("caches ownership independently for each canonical state root", async () => {
    const firstEnv = makeStateEnv();
    const secondEnv = makeStateEnv();
    const { resolveSharedAuthStoreOwnership } = await import("./path-resolve.js");
    expect(resolveSharedAuthStoreOwnership(firstEnv)).toEqual({ location: "legacy-main" });

    writeConfigMachineState(
      "auth.sharedStore",
      { location: "legacy-main", extra: true },
      { env: secondEnv },
    );

    expect(() => resolveSharedAuthStoreOwnership(secondEnv)).toThrow(
      expect.objectContaining({
        name: "InvalidSharedAuthStoreOwnershipError",
        code: "INVALID_SHARED_AUTH_STORE_OWNERSHIP",
        action: "carapace doctor --fix",
      }),
    );
    expect(resolveSharedAuthStoreOwnership(firstEnv)).toEqual({ location: "legacy-main" });
  });
});
