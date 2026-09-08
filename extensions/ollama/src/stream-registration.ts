import type { StreamFn } from "carapace/plugin-sdk/agent-core";
import { createLazyRuntimeModule } from "carapace/plugin-sdk/lazy-runtime";
import type { CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";

const loadOllamaStreamRuntime = createLazyRuntimeModule(() => import("./stream.runtime.js"));

export type OllamaLocalService = {
  providerId: string;
  acquire: CarapacePluginApi["runtime"]["llm"]["acquireLocalService"];
};

export function createLazyConfiguredOllamaStreamFn(params: {
  model: { baseUrl?: string; headers?: unknown };
  localService?: OllamaLocalService;
  providerBaseUrl?: string;
}): StreamFn {
  const streamFnPromise = loadOllamaStreamRuntime().then((runtime) =>
    runtime.createConfiguredOllamaStreamFn(params),
  );
  return async (...args) => {
    const streamFn = await streamFnPromise;
    return streamFn(...args);
  };
}
