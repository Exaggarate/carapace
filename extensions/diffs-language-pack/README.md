# @carapace/diffs-language-pack

Official extended syntax highlighting pack for the Carapace Diffs plugin.

The base `@carapace/diffs` plugin ships a curated language set. Install this package when you want the full Shiki language catalog available in rendered diff viewers and diff image/PDF output.

The pack adds highlighting for languages outside the default diffs viewer set, including Astro, Vue, Svelte, MDX, GraphQL, Terraform/HCL, Nix, Clojure, Elixir, Haskell, OCaml, Scala, Zig, Solidity, Verilog/VHDL, Fortran, MATLAB, LaTeX, Mermaid, Sass/Less/SCSS, Nginx, Apache, CSV, dotenv, INI, and diff files. See the plugin reference and Shiki language catalog for details.

## Install

```bash
carapace plugins install @carapace/diffs-language-pack
```

Restart the Gateway after installing or updating the plugin.

## Use with Diffs

Install `@carapace/diffs` first, then install this language pack. The language pack contributes static viewer assets; it does not register a separate agent tool.

## Docs

- ../../docs/tools/diffs.md
- ../../docs/plugins/reference/diffs-language-pack.md

## Package

- Plugin id: `diffs-language-pack`
- Package: `@carapace/diffs-language-pack`
- Minimum Carapace host: `2026.5.27`
