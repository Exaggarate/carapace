import { resolveAgentDir } from "carapace/plugin-sdk/agent-scope-runtime";
import type { CarapaceConfig } from "carapace/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "carapace/plugin-sdk/provider-auth-runtime";
import { normalizeOptionalString } from "carapace/plugin-sdk/string-coerce-runtime";

export async function resolveXaiRealtimeApiKey(
  configApiKey: string | undefined,
  cfg: CarapaceConfig | undefined,
  agentId?: string,
): Promise<string> {
  const direct =
    normalizeOptionalString(configApiKey) ?? normalizeOptionalString(process.env.XAI_API_KEY);
  if (direct) {
    return direct;
  }
  const auth = await resolveApiKeyForProvider({
    provider: "xai",
    cfg,
    ...(cfg && agentId ? { agentDir: resolveAgentDir(cfg, agentId) } : {}),
  });
  const oauthKey = normalizeOptionalString(auth?.apiKey);
  if (oauthKey) {
    return oauthKey;
  }
  throw new Error(
    "xAI credentials missing for realtime voice. Sign in with `carapace onboard --auth-choice xai-oauth`, run `carapace onboard --auth-choice xai-api-key`, or set XAI_API_KEY.",
  );
}
