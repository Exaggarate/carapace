import { asOptionalRecord } from "@carapace/normalization-core/record-coerce";
import type { MemoryOriginClass } from "./types.js";

export function classifySessionMessageOrigin(
  message: {
    role?: unknown;
    provenance?: unknown;
  } & Record<string, unknown>,
  turnOrigin: MemoryOriginClass,
): MemoryOriginClass {
  if (message.role === "assistant") {
    const carapaceMetadata = asOptionalRecord(message["__carapace"]);
    if (carapaceMetadata?.turnTainted === true) {
      return "untrusted";
    }
    return turnOrigin === "owner" ? "agent" : turnOrigin;
  }
  const provenance = asOptionalRecord(message.provenance);
  if (provenance?.kind === "internal_system") {
    return "system";
  }
  const metadata = asOptionalRecord(message["__carapace"]);
  return metadata?.senderIsOwner === true ? "owner" : "untrusted";
}
