# @carapace/brave-plugin

Official Brave Search provider plugin for Carapace.

This plugin registers Brave as a `web_search` provider. It supports normal Brave web search and Brave LLM Context API mode.

## Install

```bash
carapace plugins install @carapace/brave-plugin
```

Restart the Gateway after installing or updating the plugin.

## Configure

Store a Brave Search API key in plugin config or expose `BRAVE_API_KEY` to the Gateway:

```bash
carapace config set plugins.entries.brave.enabled true
carapace config set tools.web.search.provider brave
```

Provider-specific options live under `plugins.entries.brave.config.webSearch.*`.

## Docs

Full setup, config examples, search modes, and tool parameters:

- ../../docs/tools/brave-search.md

## Package

- Plugin id: `brave`
- Package: `@carapace/brave-plugin`
- Minimum Carapace host: `2026.4.10`
