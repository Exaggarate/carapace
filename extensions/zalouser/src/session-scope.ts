import type { CarapaceConfig } from "carapace/plugin-sdk/config-contracts";

export function resolveZalouserDmSessionScope(config: CarapaceConfig) {
  const configured = config.session?.dmScope;
  return configured === "main" || !configured ? "per-channel-peer" : configured;
}
