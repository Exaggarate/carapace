# @carapace/diagnostics-prometheus

Official Prometheus diagnostics exporter for Carapace.

This plugin exposes Carapace Gateway runtime metrics in Prometheus text format for Prometheus, Grafana, VictoriaMetrics, and compatible scrapers.

## Install

```bash
carapace plugins install @carapace/diagnostics-prometheus
```

Restart the Gateway after installing or updating the plugin.

## Configure

Enable the plugin and set the scrape endpoint options in `plugins.entries.diagnostics-prometheus.config`.

The full config surface, metric names, and scrape examples live in the docs:

- ../../docs/gateway/prometheus.md

## Package

- Plugin id: `diagnostics-prometheus`
- Package: `@carapace/diagnostics-prometheus`
- Minimum Carapace host: `2026.4.25`
