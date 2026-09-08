import { closeCarapaceAgentDatabases, openCarapaceAgentDatabase } from "./carapace-agent-db.js";
import { closeCarapaceStateDatabaseForTest } from "./carapace-state-db.js";

openCarapaceAgentDatabase({
  agentId: process.argv[2] ?? "worker",
  path: process.argv[3] || undefined,
});
process.send?.("ready");
process.once("message", () => {
  closeCarapaceAgentDatabases();
  closeCarapaceStateDatabaseForTest();
  process.disconnect?.();
});
