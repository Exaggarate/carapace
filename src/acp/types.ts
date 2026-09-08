/** ACP protocol helpers and Carapace agent identity metadata. */
import { VERSION } from "../version.js";
export { normalizeAcpProvenanceMode } from "@carapace/acp-core/types";

/** ACP agent identity advertised during protocol initialization. */
export const ACP_AGENT_INFO = {
  name: "carapace-acp",
  title: "Carapace ACP Gateway",
  version: VERSION,
};
