#!/usr/bin/env bash
set -euo pipefail

export HOME=/tmp/carapace-docker-selected-plugins
export CARAPACE_STATE_DIR="$HOME/.carapace"
export CARAPACE_CONFIG_PATH="$CARAPACE_STATE_DIR/carapace.json"
export CARAPACE_DISABLE_BUNDLED_SOURCE_OVERLAYS=1

mkdir -p "$CARAPACE_STATE_DIR"
node --input-type=module <<'NODE'
import fs from "node:fs";

const entries = Object.fromEntries(
  ["clickclack", "slack", "msteams", "whatsapp"].map((id) => [id, { enabled: true }]),
);
fs.writeFileSync(
  process.env.CARAPACE_CONFIG_PATH,
  `${JSON.stringify({ plugins: { entries } }, null, 2)}\n`,
  { mode: 0o600 },
);
NODE

for plugin_id in clickclack slack msteams whatsapp clawrouter; do
  node /app/carapace.mjs plugins inspect "$plugin_id" --runtime --json \
    >"/tmp/carapace-${plugin_id}-inspect.json"
done

node /carapace-e2e/assertions.mjs
