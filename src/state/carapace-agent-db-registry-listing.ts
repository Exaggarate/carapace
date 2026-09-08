import { lstatSync, statSync } from "node:fs";
import path from "node:path";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  CARAPACE_AGENT_SCHEMA_VERSION,
  type CarapaceRegisteredAgentDatabase,
} from "./carapace-agent-db-contract.js";
import {
  withExistingCarapaceStateDatabaseArtifactPreservingReadOnly,
  withExistingCarapaceStateDatabaseReadOnly,
} from "./carapace-state-db-readonly.js";
import { detectCarapaceStateDatabaseSchemaMigrationsFromDatabase } from "./carapace-state-db-schema-repair.js";
import type { DB as CarapaceStateKyselyDatabase } from "./carapace-state-db.generated.js";
import type { CarapaceStateDatabaseOptions } from "./carapace-state-db.js";
import {
  resolveCarapaceRegisteredAgentDatabasePath,
  resolveCarapaceStateSqlitePath,
} from "./carapace-state-db.paths.js";

type CarapaceAgentRegistryDatabase = Pick<CarapaceStateKyselyDatabase, "agent_databases">;

// Registry metadata is process-stable: registry writes invalidate after each commit;
// other-process changes take effect on restart. Polling here puts schema probes back on hot reads.
type AgentDatabaseRegistryMemo = {
  pathname: string;
  token: symbol;
  entries?: readonly CarapaceRegisteredAgentDatabase[];
};
// A plugin may first open a hot-created agent; its registration must invalidate
// native discovery even when subsequent callers reuse the shared connection.
const registry = resolveGlobalSingleton<{ memo?: AgentDatabaseRegistryMemo }>(
  Symbol.for("carapace.agentDatabaseRegistryMemo"),
  () => ({}),
);

function resolveAgentDatabaseRegistryPath(options: CarapaceStateDatabaseOptions): string {
  return path.resolve(options.path ?? resolveCarapaceStateSqlitePath(options.env ?? process.env));
}

function activateRegisteredAgentDatabasesMemo(
  options: CarapaceStateDatabaseOptions,
): AgentDatabaseRegistryMemo {
  const pathname = resolveAgentDatabaseRegistryPath(options);
  if (registry.memo?.pathname !== pathname) {
    // One active pathname keeps registry metadata process-stable without retaining
    // an unbounded generation map. Switching back creates a fresh generation.
    registry.memo = { pathname, token: Symbol(pathname) };
  }
  return registry.memo;
}

/** Return the process-stable generation for the active agent database registry. */
export function readCarapaceAgentDatabaseRegistryToken(
  options: CarapaceStateDatabaseOptions = {},
): symbol {
  return activateRegisteredAgentDatabasesMemo(options).token;
}

export function invalidateRegisteredAgentDatabasesMemo(
  options: CarapaceStateDatabaseOptions,
): void {
  const pathname = resolveAgentDatabaseRegistryPath(options);
  if (registry.memo?.pathname === pathname) {
    registry.memo = { pathname, token: Symbol(pathname) };
  }
}

function cloneRegisteredAgentDatabases(
  entries: readonly CarapaceRegisteredAgentDatabase[],
): CarapaceRegisteredAgentDatabase[] {
  return entries.map((entry) => ({ ...entry }));
}

function hasUnavailableMissingSqlitePath(pathname: string): boolean {
  for (const candidate of resolveSqliteDatabaseFilePaths(pathname)) {
    try {
      lstatSync(candidate);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return true;
      }
    }
  }

  let ancestor = path.dirname(pathname);
  while (true) {
    try {
      const stat = lstatSync(ancestor);
      if (!stat.isSymbolicLink()) {
        return !stat.isDirectory();
      }
      try {
        return !statSync(ancestor).isDirectory();
      } catch {
        return true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return true;
      }
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return false;
    }
    ancestor = parent;
  }
}

type AgentDatabaseRegistryListOptions = CarapaceStateDatabaseOptions & {
  includeIncompatibleSchemaVersions?: boolean;
};

function readRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions,
  artifactPreserving: boolean,
): CarapaceRegisteredAgentDatabase[] {
  const pathname = resolveAgentDatabaseRegistryPath(options);
  const read = ({ db: database }: { db: import("node:sqlite").DatabaseSync }) => {
    const schemaMigrations = detectCarapaceStateDatabaseSchemaMigrationsFromDatabase(
      database,
      pathname,
    );
    if (!artifactPreserving && schemaMigrations.length > 0) {
      throw new Error(
        `Carapace state database ${pathname} has a legacy agent database registry schema; run carapace doctor --fix to migrate it.`,
      );
    }
    const registryTable = database
      .prepare("SELECT type FROM sqlite_master WHERE name = 'agent_databases'")
      .get() as { type?: unknown } | undefined;
    if (!registryTable) {
      return [];
    }
    if (registryTable.type !== "table") {
      throw new Error(`Carapace state database ${pathname} has an invalid agent registry.`);
    }
    const db = getNodeSqliteKysely<CarapaceAgentRegistryDatabase>(database);
    return executeSqliteQuerySync(
      database,
      db
        .selectFrom("agent_databases")
        .selectAll()
        .orderBy("agent_id", "asc")
        .orderBy("path", "asc"),
    ).rows.map((row) => ({
      agentId: normalizeAgentId(row.agent_id),
      path: resolveCarapaceRegisteredAgentDatabasePath(pathname, row.path),
      schemaVersion: row.schema_version,
      lastSeenAt: row.last_seen_at,
      sizeBytes: row.size_bytes,
    }));
  };
  const entries = artifactPreserving
    ? withExistingCarapaceStateDatabaseArtifactPreservingReadOnly(read, options)
    : withExistingCarapaceStateDatabaseReadOnly(read, options);
  if (entries === undefined) {
    if (hasUnavailableMissingSqlitePath(pathname)) {
      throw new Error(`Carapace state database ${pathname} is unavailable.`);
    }
    return [];
  }
  return options.includeIncompatibleSchemaVersions
    ? entries
    : entries.filter((entry) => entry.schemaVersion === CARAPACE_AGENT_SCHEMA_VERSION);
}

/** Inspect a copied registry without creating SQLite artifacts or runtime memo state. */
export function inspectCarapaceRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions = {},
): CarapaceRegisteredAgentDatabase[] {
  return readRegisteredAgentDatabases(options, true);
}

/** List agent databases recorded in the shared Carapace state registry. */
export function listCarapaceRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions = {},
): CarapaceRegisteredAgentDatabase[] {
  const memo = activateRegisteredAgentDatabasesMemo(options);
  if (memo.entries) {
    const entries = cloneRegisteredAgentDatabases(memo.entries);
    return options.includeIncompatibleSchemaVersions
      ? entries
      : entries.filter((entry) => entry.schemaVersion === CARAPACE_AGENT_SCHEMA_VERSION);
  }
  // Discovery runs per row in list hot paths, so the legacy-schema gate and the
  // query share one process-held state handle instead of opening two connections.
  const entries = readRegisteredAgentDatabases(
    { ...options, includeIncompatibleSchemaVersions: true },
    false,
  );
  memo.entries = entries;
  const cloned = cloneRegisteredAgentDatabases(entries);
  return options.includeIncompatibleSchemaVersions
    ? cloned
    : cloned.filter((entry) => entry.schemaVersion === CARAPACE_AGENT_SCHEMA_VERSION);
}
