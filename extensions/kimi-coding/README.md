# Carapace Kimi Coding Provider

Official Carapace provider plugin for Kimi Coding.

Install from Carapace:

```bash
carapace plugins install @carapace/kimi-provider
carapace gateway restart
```

See <../../docs/providers/moonshot.md> for setup and configuration.

## Catalog notes

Model rows live in `carapace.plugin.json` under `modelCatalog.providers.kimi`.

- `k3` serves up to 1M context, tier-gated server-side; `k3-256k` is the cheaper
  256K variant of the same weights. Both point at `moonshot/kimi-k3` through
  `upstreamModel`, which keeps their `compat` capability tiers aligned with the
  `moonshot` catalog for the same model.
- Legacy `k3[1m]` was retired upstream and normalizes to `k3` for shipped
  configurations.
- `KIMI_K3_MODEL_IDS` in `provider-policy-api.ts` must cover exactly the catalog
  rows that carry a K3 `thinkingLevelMap`; `provider-catalog.test.ts` asserts it.
