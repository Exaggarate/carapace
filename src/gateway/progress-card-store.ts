import type { ProgressCard, ProgressCardStep } from "../../packages/gateway-protocol/src/index.js";
import {
  readSessionProgressCard,
  writeSessionProgressCard,
} from "../session-cards/progress-card-store.js";
import { withCarapaceAgentDatabaseReadOnly } from "../state/carapace-agent-db-readonly.js";
import { runCarapaceAgentWriteTransaction } from "../state/carapace-agent-db.js";
import { resolveGatewaySessionDatabase } from "./board-store.js";

export type ProgressCardStore = {
  get(sessionKey: string, agentId?: string): ProgressCard | null;
  put(
    sessionKey: string,
    input: {
      markdown?: string;
      steps?: ProgressCardStep[];
      expectedRevision?: number;
      assertCurrent?: () => void;
    },
    agentId?: string,
  ): { card: ProgressCard | null };
};

export const progressCardStore: ProgressCardStore = {
  get(sessionKey, agentId) {
    const resolved = resolveGatewaySessionDatabase(sessionKey, agentId);
    const result = withCarapaceAgentDatabaseReadOnly(
      (database) => readSessionProgressCard(database.db, resolved.sessionKey),
      resolved,
    );
    return result.found ? result.value : null;
  },
  put(sessionKey, input, agentId) {
    const resolved = resolveGatewaySessionDatabase(sessionKey, agentId);
    const result = runCarapaceAgentWriteTransaction(
      (transactionDatabase) => {
        input.assertCurrent?.();
        return writeSessionProgressCard(transactionDatabase.db, resolved.sessionKey, input);
      },
      resolved,
      { operationLabel: "progress-card.put" },
    );
    return "card" in result ? result : { card: null };
  },
};
