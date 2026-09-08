import { containsAsciiControlCharacter } from "@carapace/normalization-core/string-normalization";
import {
  createVerifiedSqliteSnapshot,
  type SqliteSnapshotValidator,
} from "../infra/sqlite-snapshot.js";
import { isValidAgentId, normalizeAgentId } from "../routing/session-key.js";
import { assertCarapaceAgentDatabaseForMaintenance } from "../state/carapace-agent-db.js";
import { assertCarapaceStateDatabaseForMaintenance } from "../state/carapace-state-db.js";
import {
  sanitizeCarapaceGlobalStateSnapshot,
  sanitizeCarapaceStateLeaseRows,
} from "../state/carapace-state-snapshot-sanitizer.js";
import type { SnapshotDatabaseIdentity, SnapshotDatabaseRef } from "./snapshot-provider.js";

export function normalizeSnapshotIdentity(
  identity: SnapshotDatabaseIdentity,
): SnapshotDatabaseIdentity {
  if (identity.role === "global") {
    return identity;
  }
  if (identity.role === "agent") {
    const agentId = normalizeAgentId(identity.agentId);
    if (!isValidAgentId(identity.agentId) || agentId !== identity.agentId) {
      throw new Error(`SQLite snapshot agent id must be canonical: ${identity.agentId}`);
    }
    return { role: "agent", agentId };
  }
  const id = identity.id.trim();
  if (!id || id !== identity.id || id.length > 256 || containsAsciiControlCharacter(id)) {
    throw new Error("SQLite snapshot generic database id is invalid.");
  }
  return { role: "generic", id };
}

export function buildSnapshotValidator(
  identity: SnapshotDatabaseIdentity,
): SqliteSnapshotValidator {
  if (identity.role === "global") {
    return (database, pathname) =>
      assertCarapaceStateDatabaseForMaintenance(database, { pathname });
  }
  if (identity.role === "agent") {
    return (database, pathname) =>
      assertCarapaceAgentDatabaseForMaintenance(database, {
        agentId: identity.agentId,
        pathname,
      });
  }
  return () => undefined;
}

/** Produce the canonical sanitized, compact, verified copy used by every snapshot provider. */
export async function createCarapaceSnapshotCopy(params: {
  database: SnapshotDatabaseRef;
  targetPath: string;
}): Promise<{ identity: SnapshotDatabaseIdentity; path: string; userVersion: number }> {
  const identity = normalizeSnapshotIdentity(params.database.identity);
  const result = await createVerifiedSqliteSnapshot({
    sourcePath: params.database.path,
    targetPath: params.targetPath,
    requireNonEmptySource: identity.role !== "generic",
    transform:
      identity.role === "global"
        ? sanitizeCarapaceGlobalStateSnapshot
        : identity.role === "agent"
          ? sanitizeCarapaceStateLeaseRows
          : undefined,
    validate: buildSnapshotValidator(identity),
  });
  return { identity, ...result };
}
