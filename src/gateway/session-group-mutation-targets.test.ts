import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { expect, test, vi } from "vitest";
import { upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import * as sqliteIntegrity from "../infra/sqlite-integrity.js";
import * as sqliteWal from "../infra/sqlite-wal.js";
import * as agentDatabaseLeases from "../state/carapace-agent-db-lease.js";
import {
  closeCarapaceAgentDatabasesForTest,
  listCarapaceAgentDatabasesForTest,
  CARAPACE_AGENT_DB_OPEN_HANDLE_CAP,
} from "../state/carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "../state/carapace-state-db.js";
import { setStateDirEnv, withStateDirEnv } from "../test-helpers/state-dir-env.js";
import { resolveSessionGroupMutationTargetsByName } from "./session-groups.js";

test("discovers groups across more than the handle cap without writable database maintenance", async () => {
  await withStateDirEnv("carapace-session-group-readonly-", async ({ stateDir }) => {
    setStateDirEnv(fs.realpathSync(stateDir));
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();

    const agentIds = Array.from(
      { length: CARAPACE_AGENT_DB_OPEN_HANDLE_CAP + 1 },
      (_, index) => `group-reader-${index}`,
    );
    const config = {
      agents: {
        list: agentIds.map((id, index) => ({ id, ...(index === 0 ? { default: true } : {}) })),
      },
    } satisfies CarapaceConfig;

    for (const [index, agentId] of agentIds.entries()) {
      await upsertSessionEntryCore(
        { agentId, sessionKey: `agent:${agentId}:main` },
        { category: "Shared work", sessionId: `group-session-${index}`, updatedAt: index + 1 },
      );
    }
    closeCarapaceAgentDatabasesForTest();

    const integritySpy = vi.spyOn(sqliteIntegrity, "assertSqliteIntegrity");
    const claimSpy = vi.spyOn(agentDatabaseLeases, "claimCarapaceAgentDatabaseLease");
    const releaseSpy = vi.spyOn(agentDatabaseLeases, "releaseCarapaceAgentDatabaseLease");
    const walSpy = vi.spyOn(sqliteWal, "configureSqliteConnectionPragmas");

    try {
      let targets: ReturnType<typeof resolveSessionGroupMutationTargetsByName> | undefined;
      const startedAt = performance.now();
      try {
        targets = resolveSessionGroupMutationTargetsByName(config);
      } finally {
        console.info(
          JSON.stringify({
            probe: "session-group-readonly-many-agents",
            agents: agentIds.length,
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            integrityScans: integritySpy.mock.calls.length,
            agentWalConfigurations: walSpy.mock.calls.filter(([, options]) =>
              options?.databaseLabel?.startsWith("carapace-agent:"),
            ).length,
            leaseClaims: claimSpy.mock.calls.length,
            leaseReleases: releaseSpy.mock.calls.length,
            openWriterHandles: listCarapaceAgentDatabasesForTest().length,
            groupMembers: targets?.get("Shared work")?.length ?? 0,
          }),
        );
      }

      expect(targets?.get("Shared work")).toEqual(
        agentIds.map((agentId) => ({ agentId, sessionKey: `agent:${agentId}:main` })),
      );
      expect(integritySpy.mock.calls.length).toBe(0);
      expect(claimSpy.mock.calls.length).toBe(0);
      expect(releaseSpy.mock.calls.length).toBe(0);
      expect(
        walSpy.mock.calls.filter(([, options]) =>
          options?.databaseLabel?.startsWith("carapace-agent:"),
        ),
      ).toEqual([]);
      expect(listCarapaceAgentDatabasesForTest()).toEqual([]);
    } finally {
      integritySpy.mockRestore();
      claimSpy.mockRestore();
      releaseSpy.mockRestore();
      walSpy.mockRestore();
      closeCarapaceAgentDatabasesForTest();
      closeCarapaceStateDatabaseForTest();
    }
  });
});
