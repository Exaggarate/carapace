// Exa plugin entrypoint registers its Carapace integration.
import { definePluginEntry } from "carapace/plugin-sdk/plugin-entry";
import { createExaWebSearchProvider } from "./src/exa-web-search-provider.js";

export default definePluginEntry({
  id: "exa",
  name: "Exa Plugin",
  description: "Bundled Exa web search plugin",
  register(api) {
    api.registerWebSearchProvider(createExaWebSearchProvider());
  },
});
