import type { SessionRow } from "@carapace/gateway-protocol";

export type { AgentsListResult } from "@carapace/gateway-protocol";
export type GatewaySessionRow = SessionRow & {
  hasActiveRun?: boolean;
  abortedLastRun?: boolean;
};
