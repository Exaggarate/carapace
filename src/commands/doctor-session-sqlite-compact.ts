/** Runs doctor-owned SQLite file compaction for migrated session stores. */
import fs from "node:fs";
import type { SessionStoreTarget } from "../config/sessions/targets.js";
import {
  assertCarapaceAgentDatabaseForMaintenance,
  clearCarapaceAgentDatabaseOpenFailure,
  ensureCarapaceAgentDatabasePermissions,
  isCarapaceAgentDatabaseOpen,
  migrateCarapaceAgentDatabaseForMaintenance,
  resolveCarapaceAgentSqlitePath,
  withAgentDatabaseMaintenanceLease,
} from "../state/carapace-agent-db.js";
import { resolveTargetSqliteOptions } from "./doctor-session-sqlite-readers.js";
import type { DoctorSessionSqliteCompactReport } from "./doctor-session-sqlite-types.js";
import { compactDoctorSqliteFile } from "./doctor-sqlite-compact.js";

/** Reclaim free pages from one agent session SQLite database. */
export async function compactDoctorSessionSqliteTarget(
  target: SessionStoreTarget,
  options: { env?: NodeJS.ProcessEnv; operation?: "import-finalize" } = {},
): Promise<DoctorSessionSqliteCompactReport> {
  const databaseOptions = resolveTargetSqliteOptions(target, options.env);
  const sqlitePath = resolveCarapaceAgentSqlitePath(databaseOptions);
  const beforeFileSizes = readSqliteFileSizes(sqlitePath);
  const stat = readSessionDatabaseStat(sqlitePath);
  if (!stat) {
    return {
      dbSizeAfterBytes: 0,
      dbSizeBeforeBytes: 0,
      freelistAfterPages: 0,
      freelistBeforePages: 0,
      pageSizeBytes: 0,
      reclaimedBytes: 0,
      skipped: true,
      walSizeAfterBytes: beforeFileSizes.walSizeBytes,
      walSizeBeforeBytes: beforeFileSizes.walSizeBytes,
    };
  }
  if (!stat.isFile()) {
    throw new Error(`Carapace agent database is not a regular file: ${sqlitePath}`);
  }
  if (isCarapaceAgentDatabaseOpen(sqlitePath)) {
    throw new Error(
      `Carapace agent database ${sqlitePath} is already open in this process. Stop Carapace and retry.`,
    );
  }
  const requireQuarantineCleared = () => {
    if (!clearCarapaceAgentDatabaseOpenFailure(sqlitePath, { env: options.env })) {
      throw new Error(
        `Carapace agent database ${sqlitePath} was repaired, but its persisted quarantine record could not be cleared. Rerun carapace doctor --fix so the database is not refused again.`,
      );
    }
  };
  const compactTarget = () => {
    const compact = compactDoctorSqliteFile({
      operation: options.operation,
      afterSuccess: () => {
        requireQuarantineCleared();
        ensureCarapaceAgentDatabasePermissions(sqlitePath, databaseOptions);
      },
      sqlitePath,
      validateBeforeMutation: (database) =>
        assertCarapaceAgentDatabaseForMaintenance(database, {
          agentId: databaseOptions.agentId,
          pathname: sqlitePath,
        }),
    });
    return {
      dbSizeAfterBytes: compact.after.dbSizeBytes,
      dbSizeBeforeBytes: compact.before.dbSizeBytes,
      freelistAfterPages: compact.after.freelistPages,
      freelistBeforePages: compact.before.freelistPages,
      pageSizeBytes: compact.before.pageSizeBytes || compact.after.pageSizeBytes,
      reclaimedBytes: compact.reclaimedBytes,
      skipped: false,
      walSizeAfterBytes: compact.after.walSizeBytes,
      walSizeBeforeBytes: compact.before.walSizeBytes,
    };
  };
  // The maintenance lease lives in shared state; never forward the agent database path.
  return options.operation === "import-finalize"
    ? withAgentDatabaseMaintenanceLease({ env: databaseOptions.env }, async (maintenance) => {
        await migrateCarapaceAgentDatabaseForMaintenance(
          { agentId: databaseOptions.agentId, pathname: sqlitePath },
          maintenance,
        );
        maintenance.assertOwned();
        requireQuarantineCleared();
        return compactTarget();
      })
    : compactTarget();
}

function readSessionDatabaseStat(sqlitePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(sqlitePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function readSqliteFileSizes(sqlitePath: string): { dbSizeBytes: number; walSizeBytes: number } {
  return {
    dbSizeBytes: fileSize(sqlitePath),
    walSizeBytes: fileSize(`${sqlitePath}-wal`),
  };
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}
