// Shared HTTP plumbing for chat providers: JSON POST with one automatic retry on
// 429/5xx/network errors, per-request timeout, bounded error bodies.

import { LlmError } from "../../agent.js";

const RETRY_DELAY_MS = 1_000;
const ERROR_BODY_CAP_CHARS = 400;

export function capErrorBody(text: string): string {
  if (text.length <= ERROR_BODY_CAP_CHARS) return text;
  return `${text.slice(0, ERROR_BODY_CAP_CHARS)}…`;
}

export interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  payload: string;
  timeoutMs: number;
  /** Per-turn cancellation signal (watchdog/turn budget, #68596). */
  signal?: AbortSignal;
  /** Label used in error messages, e.g. "chat/completions" or "anthropic v1/messages". */
  label: string;
}

/** POST JSON; retries once on 429/5xx/network errors, never on 4xx protocol errors. */
export async function postJsonWithRetry(options: PostJsonOptions): Promise<unknown> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers: options.headers,
        body: options.payload,
        // Per-request HTTP timeout, combined with the loop's watchdog/turn-budget
        // signal (#68596) when one is supplied.
        signal:
          options.signal === undefined
            ? AbortSignal.timeout(options.timeoutMs)
            : AbortSignal.any([AbortSignal.timeout(options.timeoutMs), options.signal]),
      });
      const body = await response.text();
      if (response.ok) {
        try {
          return JSON.parse(body) as unknown;
        } catch {
          throw new LlmError(`${options.label} returned 200 with a non-JSON body: ${capErrorBody(body)}`);
        }
      }
      lastError = `HTTP ${response.status} ${response.statusText}: ${capErrorBody(body)}`;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw new LlmError(lastError);
    } catch (error) {
      if (error instanceof LlmError) throw error;
      lastError = `network error: ${(error as Error).message}`;
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  throw new LlmError(`${options.label} failed after 2 attempts — last error: ${lastError}`);
}