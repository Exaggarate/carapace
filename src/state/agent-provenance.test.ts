import { expect, it } from "vitest";
import { withCarapaceTestState } from "../test-utils/carapace-test-state.js";
import {
  deleteAgentProvenanceForAgent,
  listAgentProvenance,
  readAgentProvenance,
  recordAgentProvenance,
} from "./agent-provenance.js";
import { openCarapaceStateDatabase } from "./carapace-state-db.js";

it("records, replaces, lists, and deletes agent creation provenance", async () => {
  await withCarapaceTestState(
    { layout: "state-only", scenario: "empty", label: "agent-provenance" },
    async (state) => {
      recordAgentProvenance("Worker", { createdVia: "operator" }, { env: state.env, nowMs: 10 });
      expect(readAgentProvenance("worker", { env: state.env })).toEqual({
        agentId: "worker",
        createdVia: "operator",
        creatorAgentId: null,
        createdAtMs: 10,
      });

      recordAgentProvenance(
        "worker",
        { createdVia: "agent", creatorAgentId: "Main" },
        { env: state.env, nowMs: 20 },
      );
      expect(listAgentProvenance({ env: state.env })).toEqual([
        {
          agentId: "worker",
          createdVia: "agent",
          creatorAgentId: "main",
          createdAtMs: 20,
        },
      ]);

      const database = openCarapaceStateDatabase({ env: state.env });
      deleteAgentProvenanceForAgent(database.db, "worker");
      expect(readAgentProvenance("worker", { env: state.env })).toBeUndefined();
    },
  );
});
