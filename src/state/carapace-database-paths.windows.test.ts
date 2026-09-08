// Windows database path tests exercise canonical state lifecycles beyond MAX_PATH.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { compactDoctorSessionSqliteTarget } from "../commands/doctor-session-sqlite-compact.js";
import { runDoctorStateSqliteCompact } from "../commands/doctor-state-sqlite-compact.js";
import { withCarapaceAgentDatabaseReadOnly } from "./carapace-agent-db-readonly.js";
import {
  closeCarapaceAgentDatabasesForTest,
  CARAPACE_AGENT_SCHEMA_VERSION,
  openCarapaceAgentDatabase,
} from "./carapace-agent-db.js";
import { resolveCarapaceAgentSqlitePath } from "./carapace-agent-db.paths.js";
import { preflightCarapaceDatabaseSchemas } from "./carapace-database-preflight.js";
import { CARAPACE_STATE_SCHEMA_VERSION } from "./carapace-state-db-contract.js";
import { withCarapaceStateDatabaseReadOnly } from "./carapace-state-db-readonly.js";
import {
  closeCarapaceStateDatabaseForTest,
  openExistingCarapaceStateDatabaseReadOnly,
  openCarapaceStateDatabase,
} from "./carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "./carapace-state-db.paths.js";

const MAX_PATH = 260;
const AGENT_ID = "windows-long-path";
const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
    cleanup();
  });
});

function createDeepStateEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    CARAPACE_STATE_DIR: tempDirs.make("carapace-database-paths-windows-"),
  };
  while (
    resolveCarapaceStateSqlitePath(env).length <= MAX_PATH ||
    resolveCarapaceAgentSqlitePath({ agentId: AGENT_ID, env }).length <= MAX_PATH
  ) {
    env.CARAPACE_STATE_DIR = path.join(env.CARAPACE_STATE_DIR, `segment-${"x".repeat(24)}`);
  }
  fs.mkdirSync(env.CARAPACE_STATE_DIR, { recursive: true });
  return env;
}

describe("Carapace database paths on Windows", () => {
  it.runIf(process.platform === "win32")(
    "opens, preflights, compacts, and reopens canonical databases beyond MAX_PATH",
    async () => {
      const env = createDeepStateEnv();
      const statePath = resolveCarapaceStateSqlitePath(env);
      const agentPath = resolveCarapaceAgentSqlitePath({ agentId: AGENT_ID, env });
      expect(statePath.startsWith("\\\\?\\")).toBe(false);
      expect(agentPath.startsWith("\\\\?\\")).toBe(false);
      expect(statePath.length).toBeGreaterThan(MAX_PATH);
      expect(agentPath.length).toBeGreaterThan(MAX_PATH);

      const state = openCarapaceStateDatabase({ env });
      const agent = openCarapaceAgentDatabase({ agentId: AGENT_ID, env });
      expect(state.path).toBe(statePath);
      expect(agent.path).toBe(agentPath);
      expect(
        state.db
          .prepare("SELECT role, schema_version FROM schema_meta WHERE meta_key = 'primary'")
          .get(),
      ).toEqual({ role: "global", schema_version: CARAPACE_STATE_SCHEMA_VERSION });
      expect(
        agent.db
          .prepare(
            "SELECT role, schema_version, agent_id FROM schema_meta WHERE meta_key = 'primary'",
          )
          .get(),
      ).toEqual({
        role: "agent",
        schema_version: CARAPACE_AGENT_SCHEMA_VERSION,
        agent_id: AGENT_ID,
      });
      closeCarapaceAgentDatabasesForTest();
      closeCarapaceStateDatabaseForTest();

      expect(
        withCarapaceStateDatabaseReadOnly(
          ({ db, path: pathname }) => ({
            pathname,
            version: db.prepare("PRAGMA user_version;").get(),
          }),
          { env },
        ),
      ).toEqual({
        pathname: statePath,
        version: { user_version: CARAPACE_STATE_SCHEMA_VERSION },
      });
      expect(
        withCarapaceAgentDatabaseReadOnly(
          ({ db, path: pathname }) => ({
            pathname,
            version: db.prepare("PRAGMA user_version;").get(),
          }),
          { agentId: AGENT_ID, env },
        ),
      ).toEqual({
        found: true,
        value: {
          pathname: agentPath,
          version: { user_version: CARAPACE_AGENT_SCHEMA_VERSION },
        },
      });
      expect(
        await preflightCarapaceDatabaseSchemas({
          env,
          supportedVersions: {
            state: CARAPACE_STATE_SCHEMA_VERSION,
            agent: CARAPACE_AGENT_SCHEMA_VERSION,
          },
        }),
      ).toEqual({ incompatible: [], indeterminate: [] });
      fs.rmSync(`${statePath}-wal`, { force: true });
      fs.rmSync(`${statePath}-shm`, { force: true });
      const stateBytesBeforeReadOnly = fs.readFileSync(statePath);
      const stateEntriesBeforeReadOnly = fs
        .readdirSync(path.dirname(statePath), { withFileTypes: true })
        .map((entry) => entry.name)
        .toSorted();
      const readOnlyState = await openExistingCarapaceStateDatabaseReadOnly({ env });
      expect(readOnlyState?.path).toBe(statePath);
      expect(
        readOnlyState?.db
          .prepare("SELECT role, schema_version FROM schema_meta WHERE meta_key = 'primary'")
          .get(),
      ).toEqual({ role: "global", schema_version: CARAPACE_STATE_SCHEMA_VERSION });
      const openedStatePath = readOnlyState?.db.prepare("PRAGMA database_list").get() as
        | { file?: unknown }
        | undefined;
      expect(path.resolve(String(openedStatePath?.file))).not.toBe(path.resolve(statePath));
      const privateDirectory = path.dirname(String(openedStatePath?.file));
      expect(readOnlyState?.walMaintenance.close()).toBe(true);
      expect(fs.existsSync(privateDirectory)).toBe(false);
      assert.deepStrictEqual(fs.readFileSync(statePath), stateBytesBeforeReadOnly);
      expect(
        fs
          .readdirSync(path.dirname(statePath), { withFileTypes: true })
          .map((entry) => entry.name)
          .toSorted(),
      ).toEqual(stateEntriesBeforeReadOnly);

      await expect(runDoctorStateSqliteCompact({ env })).resolves.toMatchObject({
        integrityCheck: "ok",
        path: statePath,
        skipped: false,
      });
      expect(
        await compactDoctorSessionSqliteTarget(
          {
            agentId: AGENT_ID,
            storePath: path.join(
              env.CARAPACE_STATE_DIR ?? "",
              "agents",
              AGENT_ID,
              "sessions",
              "sessions.json",
            ),
          },
          { env },
        ),
      ).toMatchObject({
        freelistAfterPages: 0,
        skipped: false,
        walSizeAfterBytes: 0,
      });

      expect(openCarapaceStateDatabase({ env }).path).toBe(statePath);
      expect(openCarapaceAgentDatabase({ agentId: AGENT_ID, env }).path).toBe(agentPath);
    },
  );
});
