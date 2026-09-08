#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/carapace-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_SCRIPT_B64:?missing CARAPACE_TEST_STATE_SCRIPT_B64}"
export CARAPACE_SKIP_CHANNELS=1
export CARAPACE_SKIP_GMAIL_WATCHER=1
export CARAPACE_SKIP_CRON=1
export CARAPACE_SKIP_CANVAS_HOST=1
export CARAPACE_SKIP_BROWSER_CONTROL_SERVER=1
export CARAPACE_SKIP_ACPX_RUNTIME=1
export CARAPACE_SKIP_ACPX_RUNTIME_PROBE=1
export CARAPACE_AGENT_HARNESS_FALLBACK=none
export CARAPACE_CODEX_MEDIA_PATH_APP_SERVER_LOG="/tmp/carapace-codex-media-path-app-server.jsonl"

PORT="${PORT:?missing PORT}"
TOKEN="${CARAPACE_GATEWAY_TOKEN:?missing CARAPACE_GATEWAY_TOKEN}"
PLUGIN_SPEC="${CARAPACE_CODEX_MEDIA_PATH_PLUGIN_SPEC:-npm:@carapace/codex}"
if [[ -z "${CARAPACE_CODEX_MEDIA_PATH_PLUGIN_SPEC:-}" && -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]]; then
  PLUGIN_SPEC="npm:@carapace/codex@${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}"
fi
GATEWAY_LOG="/tmp/carapace-codex-media-path-gateway.log"
CLIENT_LOG="/tmp/carapace-codex-media-path-client.log"
PLUGIN_INSTALL_LOG="/tmp/carapace-codex-media-path-plugin-install.log"
PLUGIN_INSPECT_LOG="/tmp/carapace-codex-media-path-plugin-inspect.json"
gateway_pid=""
plugin_registry_pid=""

cleanup() {
  carapace_e2e_stop_process "$gateway_pid"
  carapace_e2e_stop_process "$plugin_registry_pid"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "Codex media-path Docker E2E failed with exit code $status" >&2
  carapace_e2e_dump_logs "$PLUGIN_INSTALL_LOG" "$PLUGIN_INSPECT_LOG" "$GATEWAY_LOG" "$CLIENT_LOG" "$CARAPACE_CODEX_MEDIA_PATH_APP_SERVER_LOG"
}
carapace_e2e_enable_failure_diagnostics

entry="$(carapace_e2e_resolve_entrypoint)"
mkdir -p "$CARAPACE_STATE_DIR" "$CARAPACE_TEST_WORKSPACE_DIR"
rm -f "$CARAPACE_CODEX_MEDIA_PATH_APP_SERVER_LOG"

carapace_e2e_enable_carapace_cli_timeout
carapace_prepublish_plugin_registry_start_mounted \
  /tmp/carapace-codex-media-path-registry plugin_registry_pid '["@carapace/codex"]'

echo "Installing Codex plugin: $PLUGIN_SPEC"
carapace_e2e_fixture_plugin_command carapace -- plugins install "$PLUGIN_SPEC" --force >"$PLUGIN_INSTALL_LOG" 2>&1
carapace plugins inspect codex --runtime --json >"$PLUGIN_INSPECT_LOG"

node scripts/e2e/lib/codex-media-path/write-config.mjs

gateway_pid="$(carapace_e2e_start_gateway "$entry" "$PORT" "$GATEWAY_LOG")"
carapace_e2e_wait_gateway_ready "$gateway_pid" "$GATEWAY_LOG" 480 "$PORT"

PORT="$PORT" CARAPACE_GATEWAY_TOKEN="$TOKEN" \
  tsx scripts/e2e/lib/codex-media-path/client.mjs >"$CLIENT_LOG" 2>&1

carapace_e2e_print_log "$CLIENT_LOG"
echo "Codex media-path Docker E2E passed"
