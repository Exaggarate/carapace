import {
  openCarapaceStateDatabase,
  closeCarapaceStateDatabase,
} from "../state/carapace-state-db.js";
import {
  recordUpdateRunPhase,
  recordUpdateRunStep,
  recordUpdateRunVerification,
} from "./update-run-ledger.js";

const [runId, role] = process.argv.slice(2);
if (!runId || (role !== "cli" && role !== "gateway") || !process.env.CARAPACE_STATE_DIR) {
  throw new Error("Expected an isolated update run and writer role");
}
const options = { env: process.env };
openCarapaceStateDatabase(options);
process.once("message", () => {
  for (let index = 0; index < 16; index += 1) {
    recordUpdateRunStep(runId, { step: `${role}-${index}`, status: "completed" }, options);
  }
  if (role === "cli") {
    recordUpdateRunPhase(runId, "verifying", { after: { version: "2026.9.3" } }, options);
  } else {
    recordUpdateRunVerification(
      runId,
      {
        booted: true,
        serviceRunning: true,
        versionMatch: true,
        channelsReady: true,
        settled: true,
        readyz: true,
        pluginErrors: [],
      },
      options,
    );
  }
  closeCarapaceStateDatabase();
  process.disconnect?.();
});
process.send?.("ready");
