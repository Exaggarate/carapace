// Identifies Carapace-authored assistant rows that are transcript bookkeeping,
// not provider model output. Some history surfaces keep gateway-injected rows
// visible, so use the narrower delivery-mirror predicate when visibility matters.
export const CARAPACE_TRANSCRIPT_ARTIFACT_API = "carapace-transcript" as const;
export const CARAPACE_TRANSCRIPT_ARTIFACT_PROVIDER = "carapace" as const;
export const CARAPACE_DELIVERY_MIRROR_MODEL = "delivery-mirror" as const;
export const CRON_DIRECT_DELIVERY_CONTEXT_KIND = "cron-direct-delivery-context" as const;
const CARAPACE_GATEWAY_INJECTED_MODEL = "gateway-injected" as const;

const TRANSCRIPT_ONLY_CARAPACE_ASSISTANT_MODELS = new Set<string>([
  CARAPACE_DELIVERY_MIRROR_MODEL,
  CARAPACE_GATEWAY_INJECTED_MODEL,
]);
const CARAPACE_DELIVERY_MIRROR_KINDS = new Set([
  "channel-final",
  "channel-final-suppressed",
  "message-tool-source-reply",
  CRON_DIRECT_DELIVERY_CONTEXT_KIND,
]);

function isCarapaceDeliveryMirrorMarker(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && CARAPACE_DELIVERY_MIRROR_KINDS.has(kind);
}

export function isTranscriptOnlyCarapaceAssistantModel(provider: unknown, model: unknown): boolean {
  return (
    provider === CARAPACE_TRANSCRIPT_ARTIFACT_PROVIDER &&
    typeof model === "string" &&
    TRANSCRIPT_ONLY_CARAPACE_ASSISTANT_MODELS.has(model)
  );
}

/**
 * Returns true when the message is an Carapace-authored transcript artifact
 * that must not be replayed to providers.
 *
 * Primary check: provider="carapace" + model in known transcript-only set.
 * Fallback: a valid carapaceDeliveryMirror marker catches observed historical
 * rows whose provider/model provenance was stripped (#99470).
 */
export function isTranscriptOnlyCarapaceAssistantMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const entry = message as {
    role?: unknown;
    provider?: unknown;
    model?: unknown;
    carapaceDeliveryMirror?: unknown;
  };
  if (entry.role !== "assistant") {
    return false;
  }
  if (isTranscriptOnlyCarapaceAssistantModel(entry.provider, entry.model)) {
    return true;
  }
  return isCarapaceDeliveryMirrorMarker(entry.carapaceDeliveryMirror);
}

export function isCarapaceMessageToolMirrorAssistantMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const entry = message as { role?: unknown; carapaceMessageToolMirror?: unknown };
  return entry.role === "assistant" && entry.carapaceMessageToolMirror !== undefined;
}

export function isCarapaceDeliveryMirrorAssistantMessage(message: unknown): boolean {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const entry = message as { role?: unknown; provider?: unknown; model?: unknown };
  return (
    entry.role === "assistant" &&
    entry.provider === CARAPACE_TRANSCRIPT_ARTIFACT_PROVIDER &&
    entry.model === CARAPACE_DELIVERY_MIRROR_MODEL
  );
}
