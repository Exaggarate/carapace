// Fallback chain (M7): providers are tried in order and the first to answer serves
// the turn. Any transport-level failure — rate limit, timeout, 5xx, network error —
// moves to the next entry; every attempt and every served turn is logged so the
// operator can see which provider is actually carrying the traffic.

import { LlmError, type ChatProvider, type CompletionRequest, type CompletionResult } from "../../agent.js";

export type ProviderLog = (message: string) => void;

function defaultLog(message: string): void {
  console.log(message);
}

export class FallbackProvider implements ChatProvider {
  readonly name = "fallback";
  /** Provider that served the most recent completion (null before the first call). */
  lastServedProvider: string | null = null;

  constructor(
    private readonly providers: ChatProvider[],
    private readonly log: ProviderLog = defaultLog,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (this.providers.length === 0) throw new LlmError("no providers configured for the fallback chain");
    const failures: string[] = [];
    for (let index = 0; index < this.providers.length; index++) {
      const provider = this.providers[index];
      if (provider === undefined) continue;
      try {
        const result = await provider.complete(request);
        this.lastServedProvider = provider.name;
        this.log(
          index === 0
            ? `[llm] turn served by provider "${provider.name}"`
            : `[llm] turn served by fallback provider "${provider.name}" (${failures.length} earlier failure(s))`,
        );
        return result;
      } catch (error) {
        const message = error instanceof LlmError ? error.message : (error as Error).message;
        failures.push(`${provider.name}: ${message}`);
        this.log(
          `[llm] provider "${provider.name}" failed — ${message}` +
            (index < this.providers.length - 1 ? "; trying the next fallback" : ""),
        );
      }
    }
    throw new LlmError(`all providers failed — ${failures.join(" | ")}`);
  }
}