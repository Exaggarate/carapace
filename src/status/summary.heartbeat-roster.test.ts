import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { testing as cliBackendsTesting } from "../agents/cli-backends.test-support.js";
import type { CarapaceConfig } from "../config/types.carapace.js";
import { closeCarapaceAgentDatabasesForTest } from "../state/carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "../state/carapace-state-db.js";
import { getStatusSummary } from "./summary.js";

const AGENT_COUNT = 200;

/** Fleet enrolled through owner-target heartbeat defaults, so every agent takes the route lookup. */
function makeFleetConfig(storePath: string): CarapaceConfig {
  const entries: Record<string, { heartbeat?: { every?: string } }> = {};
  for (let index = 0; index < AGENT_COUNT; index += 1) {
    entries[`agent-${index}`] = {};
  }
  return {
    agents: {
      ownership: "explicit",
      defaults: { heartbeat: { every: "30m", target: "owner" } },
      entries,
    },
    session: { store: storePath },
  };
}

/** Counts how often the roster is read: every walk starts at `agents.entries`. */
function countRosterReads(cfg: CarapaceConfig): { cfg: CarapaceConfig; reads: () => number } {
  let reads = 0;
  const agents = new Proxy(cfg.agents as object, {
    get(target, property, receiver) {
      if (property === "entries") {
        reads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { cfg: { ...cfg, agents: agents as CarapaceConfig["agents"] }, reads: () => reads };
}

describe("getStatusSummary heartbeat roster", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  afterEach(() => {
    cliBackendsTesting.resetDepsForTest();
    closeCarapaceAgentDatabasesForTest();
    closeCarapaceStateDatabaseForTest();
  });

  it("projects heartbeat status for the whole fleet without re-walking the roster per agent", async () => {
    // An absent store keeps the read-only route probe empty; only roster work is under test.
    const storePath = path.join(
      tempDirs.make("carapace-status-heartbeat-roster-"),
      "sessions.json",
    );
    const counted = countRosterReads(makeFleetConfig(storePath));

    const summary = await getStatusSummary({ includeChannelSummary: false, config: counted.cfg });

    expect(summary.heartbeat.agents).toHaveLength(AGENT_COUNT);
    expect(summary.heartbeat.agents.every((agent) => agent.enabled && agent.waitingForRoute)).toBe(
      true,
    );
    // Enrollment plus the owner-route lookup ran per agent before; both must
    // now share one roster pass, so reads stay far below the fleet size.
    expect(counted.reads()).toBeLessThan(AGENT_COUNT);
  });
});
