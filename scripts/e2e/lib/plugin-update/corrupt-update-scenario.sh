#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/carapace-e2e-instance.sh
source scripts/e2e/lib/plugins/fixtures.sh

carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_SCRIPT_B64:?missing CARAPACE_TEST_STATE_SCRIPT_B64}"

export npm_config_loglevel=error
export npm_config_fund=false
export npm_config_audit=false
export npm_config_prefix=/tmp/npm-prefix
export NPM_CONFIG_PREFIX=/tmp/npm-prefix
export PATH="/tmp/npm-prefix/bin:$PATH"
export CI=true
export CARAPACE_NO_ONBOARD=1
export CARAPACE_NO_PROMPT=1

candidate_package="${CARAPACE_CURRENT_PACKAGE_TGZ:?missing CARAPACE_CURRENT_PACKAGE_TGZ}"
update_timeout_seconds="$(carapace_e2e_read_positive_int_env CARAPACE_UPDATE_CORRUPT_PLUGIN_TIMEOUT_SECONDS 900)"
default_update_step_timeout_seconds="$update_timeout_seconds"
if [ "$update_timeout_seconds" -gt 60 ]; then
  default_update_step_timeout_seconds=$((10#$update_timeout_seconds - 30))
fi
update_step_timeout_seconds="$(carapace_e2e_read_positive_int_env CARAPACE_UPDATE_CORRUPT_PLUGIN_STEP_TIMEOUT_SECONDS "$default_update_step_timeout_seconds")"
echo "Installing prepared candidate before same-schema corrupt-plugin update..."
if ! carapace_e2e_maybe_timeout "${CARAPACE_E2E_NPM_INSTALL_TIMEOUT:-600s}" npm install -g --prefix /tmp/npm-prefix --omit=optional "$candidate_package" >/tmp/carapace-update-corrupt-baseline-install.log 2>&1; then
  carapace_e2e_print_log /tmp/carapace-update-corrupt-baseline-install.log >&2
  exit 1
fi

package_root="$(carapace_e2e_package_root /tmp/npm-prefix)"
entry="$(carapace_e2e_package_entrypoint "$package_root")"
export CARAPACE_ENTRY="$entry"

npm_pack_dir="$(mktemp -d "/tmp/carapace-corrupt-plugin-pack.XXXXXX")"
npm_registry_dir="$(mktemp -d "/tmp/carapace-corrupt-plugin-registry.XXXXXX")"
trap 'rm -rf "$npm_pack_dir" "$npm_registry_dir"' EXIT
future_package="$npm_pack_dir/carapace-future.tgz"
node scripts/e2e/lib/update-first-hop-package-fixtures.mjs   future-tarball "$candidate_package" "$future_package"   >/tmp/carapace-corrupt-plugin-update-method.json
cat /tmp/carapace-corrupt-plugin-update-method.json
pack_fixture_plugin "$npm_pack_dir" /tmp/demo-corrupt-plugin.tgz demo-corrupt-plugin 0.0.1 demo.corrupt "Demo Corrupt Plugin"
(
  # Restore the candidate registry to prove unavailable-target refusal first.
  # The parent retains the pack directory needed for post-core result evidence.
  trap - EXIT
  start_npm_fixture_registry "@carapace/demo-corrupt-plugin" "0.0.1" /tmp/demo-corrupt-plugin.tgz "$npm_registry_dir"

  echo "Installing managed external plugin..."
  if ! carapace_e2e_fixture_plugin_command node "$entry" -- plugins install "npm:@carapace/demo-corrupt-plugin@0.0.1" --force >/tmp/carapace-corrupt-plugin-install.log 2>&1; then
    carapace_e2e_print_log /tmp/carapace-corrupt-plugin-install.log >&2
    exit 1
  fi
  node "$entry" config set plugins.allow '["demo-corrupt-plugin"]' >/dev/null
  node "$entry" config set agents.defaults.model anthropic/claude-sonnet-4-6 >/dev/null
  # Keep Doctor's route repair from re-enabling the unrelated Codex runtime.
  node "$entry" config set plugins.entries.codex.enabled false >/dev/null
  node scripts/e2e/lib/plugin-update/probe.mjs assert-corrupt-policy-preserved "$CARAPACE_CONFIG_PATH" demo-corrupt-plugin
  node "$entry" plugins inspect demo-corrupt-plugin --runtime --json >/tmp/carapace-corrupt-plugin-before.json
)

plugin_dir="$(
  node -e '
    const fs = require("node:fs");
    const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const installPath = payload.install?.installPath ?? payload.plugin?.rootDir;
    if (!installPath) {
      throw new Error("missing plugin install path in inspect output");
    }
    process.stdout.write(installPath);
  ' /tmp/carapace-corrupt-plugin-before.json
)"
rm -f "$plugin_dir/package.json"
if [ -f "$plugin_dir/package.json" ]; then
  echo "Expected corrupt plugin package.json to be removed before update." >&2
  exit 1
fi

capture_corrupt_state() {
  node --input-type=module - "$CARAPACE_CONFIG_PATH" "$plugin_dir" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { readPluginInstallRecords } from "./scripts/e2e/lib/plugin-index-sqlite.mjs";
const [configPath, pluginDir] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  config: fs.readFileSync(configPath, "utf8"),
  records: readPluginInstallRecords(),
  packageJsonExists: fs.existsSync(path.join(pluginDir, "package.json")),
  entry: fs.readFileSync(path.join(pluginDir, "index.js"), "utf8"),
  manifest: fs.readFileSync(path.join(pluginDir, "carapace.plugin.json"), "utf8"),
}));
NODE
}

run_corrupt_update() {
  local output_prefix="$1"
  carapace_e2e_maybe_timeout "${update_timeout_seconds}s" \
    node "$entry" update \
    --channel beta \
    --tag "$future_package" \
    --yes \
    --no-restart \
    --timeout "$update_step_timeout_seconds" \
    --json \
    >"$output_prefix.json" 2>"$output_prefix.err"
}

echo "Checking unavailable corrupt-plugin target preserves the installation..."
state_before_refusal="$(capture_corrupt_state)"
if run_corrupt_update /tmp/carapace-corrupt-plugin-unavailable; then
  echo "Expected the unavailable plugin target to refuse the core update." >&2
  exit 1
fi
node scripts/e2e/lib/plugin-update/probe.mjs assert-corrupt-unavailable /tmp/carapace-corrupt-plugin-unavailable.json demo-corrupt-plugin
if [ "$(capture_corrupt_state)" != "$state_before_refusal" ]; then
  echo "Unavailable plugin admission changed config, install records, or corrupt payload." >&2
  exit 1
fi
source_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).sourceVersion' /tmp/carapace-corrupt-plugin-update-method.json)"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-package-version "$package_root" "$source_version" unavailable-plugin-refusal

# The recovery case has a real registry package to reinstall; admission must not be bypassed.
mkdir "$npm_registry_dir/recovery"
start_npm_fixture_registry "@carapace/demo-corrupt-plugin" "0.0.1" /tmp/demo-corrupt-plugin.tgz "$npm_registry_dir/recovery"
echo "Updating Carapace with a recoverable corrupt plugin present..."
if run_corrupt_update /tmp/carapace-update-corrupt-plugin; then
  update_status=0
else
  update_status=$?
fi
if [ "$update_status" -ne 0 ]; then
  echo "carapace update failed or timed out after ${update_timeout_seconds}s with corrupt plugin present" >&2
  carapace_e2e_print_log /tmp/carapace-update-corrupt-plugin.err >&2
  carapace_e2e_print_log /tmp/carapace-update-corrupt-plugin.json >&2
  exit "$update_status"
fi
future_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).targetVersion' /tmp/carapace-corrupt-plugin-update-method.json)"
node scripts/e2e/lib/release-scenarios/assertions.mjs   assert-package-version "$package_root" "$future_version" same-schema-update

if ! node scripts/e2e/lib/plugin-update/probe.mjs assert-corrupt-update /tmp/carapace-update-corrupt-plugin.json demo-corrupt-plugin; then
  echo "corrupt update JSON payload:" >&2
  carapace_e2e_print_log /tmp/carapace-update-corrupt-plugin.json >&2
  echo "corrupt update stderr:" >&2
  carapace_e2e_print_log /tmp/carapace-update-corrupt-plugin.err >&2
  exit 1
fi
node scripts/e2e/lib/plugin-update/probe.mjs assert-corrupt-policy-preserved "$CARAPACE_CONFIG_PATH" demo-corrupt-plugin
