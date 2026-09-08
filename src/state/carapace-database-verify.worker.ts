import { formatSqliteErrorCodeSuffix } from "../infra/sqlite-error-diagnostics.js";
import { CARAPACE_SQLITE_BUSY_TIMEOUT_MS } from "./carapace-state-db-contract.js";

const DATABASE_VERIFY_CHILD_ARG = "--carapace-database-verify-child";

export type CarapaceDatabaseVerifyTarget = {
  path: string;
  kind: "agent" | "state";
  label: string;
};

export type CarapaceDatabaseVerifyResult = {
  path: string;
  ok: boolean;
  error?: string;
  terminal?: boolean;
};

function isVerifyTarget(value: unknown): value is CarapaceDatabaseVerifyTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    typeof target.path === "string" &&
    (target.kind === "agent" || target.kind === "state") &&
    typeof target.label === "string"
  );
}

function formatVerifyError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${message}${formatSqliteErrorCodeSuffix(error)}`;
}

async function verifyCarapaceDatabase(
  target: CarapaceDatabaseVerifyTarget,
): Promise<CarapaceDatabaseVerifyResult> {
  const [sqlite, integrity, location] = await Promise.all([
    import("../infra/node-sqlite.js"),
    import("../infra/sqlite-integrity.js"),
    import("../infra/sqlite-readonly-location.js"),
  ]);
  let cleanup: (() => boolean) | undefined;
  let database: import("node:sqlite").DatabaseSync | undefined;
  let result = await (async (): Promise<CarapaceDatabaseVerifyResult> => {
    try {
      const prepared = await location.prepareSqliteReadOnlyLocationInProcess(target.path);
      cleanup = prepared.cleanup;
      database = sqlite.openNodeSqliteDatabase(prepared.location, {
        readOnly: true,
      });
      database.exec(`PRAGMA busy_timeout = ${CARAPACE_SQLITE_BUSY_TIMEOUT_MS};`);
      integrity.assertSqliteIntegrity(database, target.label);
      return { path: target.path, ok: true };
    } catch (error) {
      const terminal = error instanceof Error && integrity.isTerminalSqliteIntegrityError(error);
      return {
        path: target.path,
        ok: false,
        error: formatVerifyError(error),
        terminal,
      };
    }
  })();
  try {
    database?.close();
  } catch (error) {
    if (result.ok) {
      result = {
        path: target.path,
        ok: false,
        error: formatVerifyError(error),
        terminal: false,
      };
    }
  } finally {
    cleanup?.();
  }
  return result;
}

/** Verify database files serially so large agent scans never compete for I/O. */
export async function verifyCarapaceDatabases(
  targets: readonly CarapaceDatabaseVerifyTarget[],
): Promise<CarapaceDatabaseVerifyResult[]> {
  const results: CarapaceDatabaseVerifyResult[] = [];
  for (const target of targets) {
    results.push(await verifyCarapaceDatabase(target));
  }
  return results;
}

// This module is also imported for its verifier function. Only the dedicated
// child may consume and disconnect the process-wide IPC channel.
const sendToParent =
  process.argv[2] === DATABASE_VERIFY_CHILD_ARG ? process.send?.bind(process) : undefined;
if (sendToParent) {
  process.once("message", (message: unknown) => {
    void (async () => {
      try {
        const targets = Array.isArray(message) ? message.filter(isVerifyTarget) : [];
        const results = await verifyCarapaceDatabases(targets);
        await new Promise<void>((resolve, reject) => {
          sendToParent(results, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch {
        process.exitCode = 1;
      } finally {
        process.disconnect?.();
      }
    })();
  });
}
