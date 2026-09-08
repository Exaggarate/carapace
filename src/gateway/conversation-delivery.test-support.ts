import path from "node:path";
import { onTestFinished, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  beginConversationDeliveryOperation,
  getConversationDeliveryOperation,
  markConversationDeliveryQueued,
  markConversationDeliverySent,
  markConversationDeliverySuppressed,
} from "../config/sessions/conversation-delivery-store.js";
import { registerConversationAddresses } from "../config/sessions/conversation-registry.js";
import { buildConversationRef } from "../routing/conversation-ref.js";
import { closeCarapaceAgentDatabaseByPath } from "../state/carapace-agent-db.js";

const address = {
  channel: "reef",
  accountId: "default",
  kind: "direct" as const,
  peerId: "molty",
};

export const conversation = {
  ...address,
  conversationRef: buildConversationRef(address),
  target: "reef:molty",
  sessionId: "reef-session",
  sessionKey: "agent:main:reef:direct:molty",
  role: "participant" as const,
  firstSeenAt: 100,
  lastSeenAt: 200,
};

export function createConversationDeliveryTestStore(agentId = "main") {
  const dirs = createTempDirTracker();
  const agentDir = path.join(dirs.make("carapace-gateway-conversation-"), "agents", agentId);
  const scope = { agentId, storePath: path.join(agentDir, "sessions", "sessions.json") };
  onTestFinished(() => {
    closeCarapaceAgentDatabaseByPath(path.join(agentDir, "agent", "carapace-agent.sqlite"));
    dirs.cleanup();
  });
  registerConversationAddresses(scope, [{ ...conversation, deliveryTarget: conversation.target }]);
  return {
    scope,
    config: { session: { store: scope.storePath } },
    beginOperation: vi.fn(beginConversationDeliveryOperation),
    getOperation: vi.fn(getConversationDeliveryOperation),
    markQueued: vi.fn(markConversationDeliveryQueued),
    markSent: vi.fn(markConversationDeliverySent),
    markSuppressed: vi.fn(markConversationDeliverySuppressed),
  };
}
