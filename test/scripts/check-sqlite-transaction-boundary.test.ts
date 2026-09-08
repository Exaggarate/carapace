import { describe, expect, it } from "vitest";
import { findSqliteTransactionBoundaryViolations } from "../../scripts/check-sqlite-transaction-boundary.mts";

describe("SQLite transaction boundary guard", () => {
  it("rejects removed async transaction primitives", () => {
    expect(
      findSqliteTransactionBoundaryViolations(`
        import { runSqliteImmediateTransactionAsync } from "./sqlite-transaction.js";
        export async function runCarapaceAgentWriteTransactionAsync() {}
        await database.runSqliteImmediateTransactionAsync(async () => undefined);
      `),
    ).toEqual([
      {
        line: 2,
        reason:
          'imports removed async SQLite transaction primitive "runSqliteImmediateTransactionAsync"',
      },
      {
        line: 3,
        reason:
          'declares removed async SQLite transaction primitive "runCarapaceAgentWriteTransactionAsync"',
      },
      {
        line: 4,
        reason:
          'calls removed async SQLite transaction primitive "runSqliteImmediateTransactionAsync"',
      },
    ]);
  });

  it("rejects inline async callbacks passed to synchronous transaction helpers", () => {
    expect(
      findSqliteTransactionBoundaryViolations(`
        runSqliteImmediateTransactionSync(db, async () => await prepare());
        runCarapaceAgentWriteTransaction(async (database) => await write(database), options);
        runCarapaceStateWriteTransaction(async (database) => await write(database));
      `),
    ).toEqual([
      {
        line: 2,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
      {
        line: 3,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runCarapaceAgentWriteTransaction"',
      },
      {
        line: 4,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runCarapaceStateWriteTransaction"',
      },
    ]);
  });

  it("rejects local async function references passed as callbacks", () => {
    expect(
      findSqliteTransactionBoundaryViolations(`
        async function writeRows() {}
        const writeAgentRows = async () => undefined;
        runSqliteImmediateTransactionSync(db, writeRows);
        runCarapaceAgentWriteTransaction(writeAgentRows, options);
      `),
    ).toEqual([
      {
        line: 4,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
      {
        line: 5,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runCarapaceAgentWriteTransaction"',
      },
    ]);
  });

  it("tracks aliases of synchronous transaction imports", () => {
    expect(
      findSqliteTransactionBoundaryViolations(`
        import { runSqliteImmediateTransactionSync as transact } from "./sqlite-transaction.js";
        transact(db, async () => undefined);
      `),
    ).toEqual([
      {
        line: 3,
        reason:
          'passes an async callback to synchronous SQLite transaction helper "runSqliteImmediateTransactionSync"',
      },
    ]);
  });

  it("allows asynchronous preparation followed by a synchronous commit callback", () => {
    expect(
      findSqliteTransactionBoundaryViolations(`
        const prepared = await prepareMutation();
        runCarapaceAgentWriteTransaction((database) => {
          validate(database, prepared.expected);
          apply(database, prepared.patch);
        }, options);
      `),
    ).toEqual([]);
  });
});
