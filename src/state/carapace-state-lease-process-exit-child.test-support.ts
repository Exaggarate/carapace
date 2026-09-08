import { withCarapaceStateLease } from "./carapace-state-lease.js";

const stateDir = process.argv[2];
if (!stateDir) {
  throw new Error("state lease process-exit child requires a state directory");
}
const heartbeat = process.argv[3] === "worker" ? "worker" : undefined;

await withCarapaceStateLease(
  {
    scope: "core:test",
    key: "process-exit",
    database: {
      scope: "shared",
      options: { env: { ...process.env, CARAPACE_STATE_DIR: stateDir } },
    },
    leaseMs: 300_000,
    waitMs: 0,
    heartbeat,
  },
  async () => process.exit(23),
);
