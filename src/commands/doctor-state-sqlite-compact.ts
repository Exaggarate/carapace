/** Explicit doctor maintenance for the canonical shared state SQLite database. */
import fs from "node:fs";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import { clearCarapaceDatabaseQuarantine } from "../state/carapace-quarantine-store.js";
import {
  assertCarapaceStateDatabaseForMaintenance,
  clearCarapaceStateDatabaseOpenFailure,
  ensureCarapaceStatePermissions,
  isCarapaceStateDatabaseOpen,
} from "../state/carapace-state-db.js";
import { resolveCarapaceStateSqlitePath } from "../state/carapace-state-db.paths.js";
import {
  assertCarapaceStateWriteAllowed,
  runWithCarapaceStateWriteAccess,
} from "../state/carapace-state-ownership.js";
import {
  compactDoctorSqliteFile,
  type DoctorSqliteCompactSnapshot,
} from "./doctor-sqlite-compact.js";
import { withDoctorSqliteMaintenanceLock } from "./doctor-sqlite-maintenance-lock.js";

type DoctorStateSqliteCompactReport =
  | {
      mode: "compact";
      path: string;
      reason: "missing";
      skipped: true;
    }
  | {
      after: DoctorSqliteCompactSnapshot;
      before: DoctorSqliteCompactSnapshot;
      integrityCheck: "ok";
      mode: "compact";
      path: string;
      reclaimedBytes: number;
      skipped: false;
    };

type DoctorStateSqliteCompactOptions = {
  env?: NodeJS.ProcessEnv;
};

type DoctorStateSqliteCompactDeps = {
  busyTimeoutMs?: number;
  withMaintenanceLock?: typeof withDoctorSqliteMaintenanceLock;
};

/** Compact only the canonical shared state database resolved for this invocation. */
export async function runDoctorStateSqliteCompact(
  options: DoctorStateSqliteCompactOptions = {},
  deps: DoctorStateSqliteCompactDeps = {},
): Promise<DoctorStateSqliteCompactReport> {
  const env = options.env ?? process.env;
  const sqlitePath = resolveCarapaceStateSqlitePath(env);
  const stat = readCanonicalStateDatabaseStat(sqlitePath);
  if (!stat) {
    return {
      mode: "compact",
      path: sqlitePath,
      reason: "missing",
      skipped: true,
    };
  }
  if (!stat.isFile()) {
    throw new Error(`Canonical Carapace state database is not a regular file: ${sqlitePath}`);
  }
  const withMaintenanceLock = deps.withMaintenanceLock ?? withDoctorSqliteMaintenanceLock;
  return await withMaintenanceLock({
    env,
    operation: "state SQLite compaction",
    protectedPaths: resolveSqliteDatabaseFilePaths(sqlitePath),
    run: () =>
      runWithCarapaceStateWriteAccess(
        { databasePath: sqlitePath, env },
        "state SQLite compaction",
        () => {
          if (isCarapaceStateDatabaseOpen()) {
            throw new Error(
              "The shared Carapace state database is already open in this process. Stop Carapace and retry.",
            );
          }

          const compact = compactDoctorSqliteFile({
            afterSuccess: () => {
              if (!clearCarapaceDatabaseQuarantine(sqlitePath, { env })) {
                throw new Error(
                  `Carapace state database ${sqlitePath} was compacted, but its persisted quarantine record could not be cleared. Rerun carapace doctor --fix so the database is not refused again.`,
                );
              }
              clearCarapaceStateDatabaseOpenFailure(sqlitePath);
              ensureCarapaceStatePermissions(sqlitePath, env);
            },
            ...(deps.busyTimeoutMs !== undefined ? { busyTimeoutMs: deps.busyTimeoutMs } : {}),
            sqlitePath,
            validateBeforeMutation: (database) => {
              assertCarapaceStateWriteAllowed({ database, databasePath: sqlitePath, env });
              assertCarapaceStateDatabaseForMaintenance(database, { pathname: sqlitePath });
            },
          });
          return {
            ...compact,
            mode: "compact",
            path: sqlitePath,
            skipped: false,
          };
        },
      ),
  });
}

function readCanonicalStateDatabaseStat(sqlitePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(sqlitePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
