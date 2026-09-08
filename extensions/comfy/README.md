# @carapace/comfy-provider

Official ComfyUI image, video, and music generation provider plugin for
Carapace.

## Install

```bash
carapace plugins install @carapace/comfy-provider
carapace gateway restart
```

## Configure

Local ComfyUI workflows do not require credentials. Comfy Cloud workflows use
`COMFY_API_KEY` or `COMFY_CLOUD_API_KEY`.

Full workflow, model, and provider configuration:

- ../../docs/providers/comfy.md

## Package

- Plugin id: `comfy`
- Package: `@carapace/comfy-provider`
- Minimum Carapace host: `2026.7.2`
