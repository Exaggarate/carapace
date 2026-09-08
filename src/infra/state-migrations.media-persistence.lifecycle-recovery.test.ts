import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeCarapaceAgentDatabasesForTest,
  openCarapaceAgentDatabase,
} from "../state/carapace-agent-db.js";
import {
  closeCarapaceStateDatabaseForTest,
  openCarapaceStateDatabase,
} from "../state/carapace-state-db.js";
import {
  completeGatewayBootLifecycle,
  inspectGatewayCrashLoopBreaker,
  recordGatewayBootStart,
} from "./gateway-boot-lifecycle.js";
import { requireNodeSqlite } from "./node-sqlite.js";
import { GATEWAY_STARTUP_MAINTENANCE_REQUIRED_REASON } from "./startup-maintenance-required.js";
import { migrateLegacyMediaPersistence } from "./state-migrations.media-persistence.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeCarapaceAgentDatabasesForTest();
  closeCarapaceStateDatabaseForTest();
});

describe("media persistence gateway lifecycle recovery", () => {
  it("leaves maintenance completion to Doctor after a successful media migration", async () => {
    const stateDir = tempDirs.make("media-persistence-startup-recovery-");
    const env = { CARAPACE_STATE_DIR: stateDir };
    const databasePath = openCarapaceAgentDatabase({ agentId: "main", env }).path;
    closeCarapaceAgentDatabasesForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(databasePath);
    database.exec(`
      DROP TABLE session_participants;
      PRAGMA user_version = 14;
      UPDATE schema_meta SET schema_version = 14 WHERE meta_key = 'primary';
    `);
    database.close();

    const nowMs = 1_000_000;
    for (let index = 0; index < 3; index += 1) {
      const bootId = recordGatewayBootStart(env, nowMs + index);
      completeGatewayBootLifecycle(
        bootId,
        {
          outcome: "startup_failed",
          reason: `migration required ${index}`,
          startupReason: GATEWAY_STARTUP_MAINTENANCE_REQUIRED_REASON,
        },
        env,
        nowMs + index + 1,
      );
    }
    expect(inspectGatewayCrashLoopBreaker(env, nowMs + 4).tripped).toBe(false);

    const result = await migrateLegacyMediaPersistence({ env });

    expect(result.warnings).toEqual([]);
    expect(
      openCarapaceStateDatabase({ env })
        .db.prepare(
          "SELECT COUNT(*) AS count FROM gateway_boot_lifecycle WHERE outcome = 'startup_failed'",
        )
        .get(),
    ).toMatchObject({ count: 3 });
    expect(inspectGatewayCrashLoopBreaker(env, nowMs + 5)).toMatchObject({
      tripped: false,
      uncleanBoots: 0,
    });
  });
});
