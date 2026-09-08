import "./ai-transport-runtime-host.js";
import "@carapace/ai/transports";

const responsesTesting = globalThis.carapaceOpenAIResponsesTransportTestApi;
if (!responsesTesting) {
  throw new Error("OpenAI transport test APIs are unavailable outside test mode");
}

type OpenAIResponsesTransportTestApi = NonNullable<
  typeof globalThis.carapaceOpenAIResponsesTransportTestApi
>;

// Keep declaration emit on the public test-API names instead of transport internals.
export const testing: OpenAIResponsesTransportTestApi = responsesTesting;
