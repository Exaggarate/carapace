import { resolveClaudeThinkingProfile } from "carapace/plugin-sdk/claude-model-runtime";
import type {
  ProviderDefaultThinkingPolicyContext,
  ProviderThinkingProfile,
} from "carapace/plugin-sdk/plugin-entry";
import { resolveEffortThinkingProfile } from "carapace/plugin-sdk/provider-thinking-runtime";

const FIXED_REASONING_PROFILE = {
  levels: [{ id: "off", label: "always on" }],
  defaultLevel: "off",
} as const satisfies ProviderThinkingProfile;

export function resolveThinkingProfile(params: ProviderDefaultThinkingPolicyContext) {
  const modelId = params.modelId.trim().toLowerCase();
  if (modelId.startsWith("claude-")) {
    return resolveClaudeThinkingProfile(modelId);
  }
  const effortProfile = resolveEffortThinkingProfile(params.compat?.supportedReasoningEfforts);
  if (effortProfile) {
    return effortProfile;
  }
  return params.reasoning === true && params.api !== "anthropic-messages"
    ? FIXED_REASONING_PROFILE
    : undefined;
}
