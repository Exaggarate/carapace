// Duckduckgo provider module implements model/runtime integration.
import { createWebSearchProviderContractFields } from "carapace/plugin-sdk/provider-web-search-contract";

const DUCKDUCKGO_ONBOARDING_SCOPES: Array<"text-inference"> = ["text-inference"];

export function createDuckDuckGoWebSearchProviderBase() {
  return {
    id: "duckduckgo",
    label: "DuckDuckGo Search (experimental)",
    hint: "Free web search fallback with no API key required",
    onboardingScopes: [...DUCKDUCKGO_ONBOARDING_SCOPES],
    requiresCredential: false,
    envVars: [],
    placeholder: "(no key needed)",
    signupUrl: "https://duckduckgo.com/",
    docsUrl: "https://github.com/Exaggarate/carapace",
    autoDetectOrder: 100,
    credentialPath: "",
    ...createWebSearchProviderContractFields({
      credentialPath: "",
      searchCredential: { type: "scoped", scopeId: "duckduckgo" },
      selectionPluginId: "duckduckgo",
    }),
  };
}
