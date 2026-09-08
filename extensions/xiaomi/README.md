# Carapace Xiaomi Provider

Official Carapace provider plugin for Xiaomi MiMo pay-as-you-go and Token Plan
models, usage tracking, and text-to-speech.

Install from Carapace:

```bash
carapace plugins install @carapace/xiaomi-provider
carapace gateway restart
```

Configure `XIAOMI_API_KEY` for `xiaomi/*` models and speech, or
`XIAOMI_TOKEN_PLAN_API_KEY` for `xiaomi-token-plan/*` models. See
../../docs/providers/xiaomi.md for regional Token Plan setup and
the full model and speech configuration.
