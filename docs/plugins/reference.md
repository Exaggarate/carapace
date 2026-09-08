---
summary: "Generated index of Carapace plugin reference pages"
read_when:
  - You need a reference page for a specific Carapace plugin
  - You are auditing plugin docs coverage
title: "Plugin reference"
---

<!-- Generated file. Do not edit by hand.
Run `pnpm plugins:inventory:gen` to rebuild it. -->

This section holds one reference page for each Carapace plugin. Each page states
the package, the install route, and the surface the plugin adds.

Use [Plugin inventory](/plugins/plugin-inventory) to browse all 152
generated plugin reference pages by distribution, package, and description.

## How this page is built

Carapace generates this page from the top-level
`extensions/*/carapace.plugin.json` manifests. Package metadata enriches
entries when `package.json` is present. Regenerate the page with:

```bash
pnpm plugins:inventory:gen
```
