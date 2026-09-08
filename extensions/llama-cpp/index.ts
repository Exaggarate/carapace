import { definePluginEntry, type CarapacePluginApi } from "carapace/plugin-sdk/plugin-entry";
import { llamaCppEmbeddingProviderAdapter } from "./src/embedding-provider.js";
import { registerLlamaCppProvider } from "./src/managed-provider.js";

export default definePluginEntry({
  id: "llama-cpp",
  name: "llama.cpp Provider",
  description: "Managed and external llama.cpp servers for GGUF chat and embeddings",
  register(api: CarapacePluginApi) {
    api.registerEmbeddingProvider(llamaCppEmbeddingProviderAdapter);
    registerLlamaCppProvider(api);
  },
});
