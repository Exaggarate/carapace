# @carapace/memory-lancedb

Official LanceDB-backed long-term memory plugin for Carapace.

This plugin adds persistent memory tools backed by LanceDB, vector search, auto-recall, and auto-capture.

## Install

```bash
carapace plugins install @carapace/memory-lancedb
```

Restart the Gateway after installing or updating the plugin.

## What it provides

- `memory_store`
- `memory_recall`
- `memory_forget`
- LanceDB vector storage and hybrid memory retrieval.

## Configure

Use the memory plugin docs for embedding provider setup, storage paths, indexing, and recall behavior:

- ../../docs/plugins/memory-lancedb.md

## Package

- Plugin id: `memory-lancedb`
- Package: `@carapace/memory-lancedb`
- Minimum Carapace host: `2026.4.10`
