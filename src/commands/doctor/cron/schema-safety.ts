import { isSqliteSchemaVersionError } from "../../../infra/sqlite-user-version.js";
import { withExistingCarapaceStateDatabaseArtifactPreservingReadOnly } from "../../../state/carapace-state-db-readonly.js";

export function assertCronStateSchemaSupported(env?: NodeJS.ProcessEnv): void {
  withExistingCarapaceStateDatabaseArtifactPreservingReadOnly(() => undefined, { env });
}

export function rethrowSqliteSchemaVersionError(error: unknown): void {
  if (isSqliteSchemaVersionError(error)) {
    throw error;
  }
}
