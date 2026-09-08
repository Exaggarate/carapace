type FallbackSkipCacheState = {
  buckets: Map<string, Map<string, unknown>>;
  lastGlobalPruneAtMs: number;
};

function getFallbackSkipCacheGlobals() {
  return globalThis as typeof globalThis & {
    carapaceFallbackSkipCache?: Map<string, Map<string, unknown>>;
    carapaceFallbackSkipCacheState?: FallbackSkipCacheState;
  };
}

export function resetFallbackSkipCacheForTest(): void {
  const globals = getFallbackSkipCacheGlobals();
  globals.carapaceFallbackSkipCache?.clear();
  globals.carapaceFallbackSkipCacheState?.buckets.clear();
  if (globals.carapaceFallbackSkipCacheState) {
    globals.carapaceFallbackSkipCacheState.lastGlobalPruneAtMs = 0;
  }
}

export function listFallbackSkipCacheSessionIdsForTest(): string[] {
  const globals = getFallbackSkipCacheGlobals();
  return [...(globals.carapaceFallbackSkipCacheState?.buckets.keys() ?? [])];
}
