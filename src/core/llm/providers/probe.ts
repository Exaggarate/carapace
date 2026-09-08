// Doctor-side reachability probes for configured providers (M7): GET the provider's
// model-list endpoint with a bounded timeout. Never runs agent turns, never logs
// credentials.

export interface ProviderProbeResult {
  ok: boolean;
  /** true = a definite configuration problem (credentials rejected) → doctor FAILs. */
  fatal: boolean;
  detail: string;
}

const PROBE_TIMEOUT_MS = 3_000;

export async function probeProviderEndpoint(
  kind: string,
  baseURL: string,
  apiKey: string,
): Promise<ProviderProbeResult> {
  const base = baseURL.replace(/\/+$/, "");
  const url = kind === "anthropic" ? `${base}/v1/models` : `${base}/models`;
  const headers: Record<string, string> = {};
  if (kind === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey !== "") {
    headers.authorization = `Bearer ${apiKey}`;
  }
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (response.ok) return { ok: true, fatal: false, detail: `reachable (HTTP ${response.status} on GET ${url})` };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, fatal: true, detail: `credentials rejected (HTTP ${response.status} on GET ${url})` };
    }
    return { ok: false, fatal: false, detail: `endpoint answered HTTP ${response.status} on GET ${url}` };
  } catch (error) {
    return { ok: false, fatal: false, detail: `unreachable (${(error as Error).message})` };
  }
}