# @carapace/pixverse-provider

Official PixVerse video generation provider plugin for Carapace.

This plugin registers PixVerse as a `video_generate` provider for text-to-video and image-to-video workflows.

## Install

```bash
carapace plugins install @carapace/pixverse-provider
```

Restart the Gateway after installing or updating the plugin.

## Configure

Store your PixVerse API key in Carapace config or expose the supported environment variable to the Gateway. Then select PixVerse as a video generation provider.

Full setup and model/provider examples:

- ../../docs/providers/pixverse.md

## Package

- Plugin id: `pixverse`
- Package: `@carapace/pixverse-provider`
- Minimum Carapace host: `2026.5.26`
