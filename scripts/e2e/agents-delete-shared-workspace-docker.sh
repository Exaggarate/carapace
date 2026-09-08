#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_ROOT="${CARAPACE_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "carapace-agents-delete-shared-workspace-e2e:local" CARAPACE_AGENTS_DELETE_SHARED_WORKSPACE_E2E_IMAGE)"
SKIP_BUILD="${CARAPACE_AGENTS_DELETE_SHARED_WORKSPACE_E2E_SKIP_BUILD:-0}"
DOCKER_COMMAND_TIMEOUT="${CARAPACE_AGENTS_DELETE_SHARED_WORKSPACE_DOCKER_COMMAND_TIMEOUT:-300s}"
CARAPACE_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 agents-delete-shared-workspace empty)"

docker_e2e_build_or_reuse "$IMAGE_NAME" agents-delete-shared-workspace "$SOURCE_ROOT/Dockerfile" "$SOURCE_ROOT" "" "$SKIP_BUILD"
docker_e2e_harness_mount_args

run_logged agents-delete-shared-workspace docker_e2e_docker_cmd run --rm \
  "${DOCKER_E2E_HARNESS_ARGS[@]}" \
  --entrypoint bash \
  -e CARAPACE_SKIP_CHANNELS=1 \
  -e CARAPACE_SKIP_PROVIDERS=1 \
  -e CARAPACE_SKIP_GMAIL_WATCHER=1 \
  -e CARAPACE_SKIP_CRON=1 \
  -e CARAPACE_SKIP_CANVAS_HOST=1 \
  -e CARAPACE_SKIP_BROWSER_CONTROL_SERVER=1 \
  -e CARAPACE_SKIP_ACPX_RUNTIME=1 \
  -e CARAPACE_SKIP_ACPX_RUNTIME_PROBE=1 \
  -e CARAPACE_GATEWAY_TOKEN=agents-delete-shared-workspace-token \
  -e "CARAPACE_TEST_STATE_SCRIPT_B64=$CARAPACE_TEST_STATE_SCRIPT_B64" \
  "$IMAGE_NAME" \
  -lc '
set -euo pipefail
source scripts/lib/carapace-e2e-instance.sh

carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_SCRIPT_B64:?missing CARAPACE_TEST_STATE_SCRIPT_B64}"
export SHARED_WORKSPACE="$HOME/workspace-shared"
output_file="$HOME/delete.json"
agents_file="$HOME/agents.json"
gateway_log="$HOME/gateway.log"
gateway_pid=""

cleanup() {
  carapace_e2e_terminate_gateways "${gateway_pid:-}"
  rm -rf "$HOME"
}
dump_logs_on_error() {
  local status=$?
  carapace_e2e_print_log "$gateway_log" >&2
  exit "$status"
}
trap cleanup EXIT
trap dump_logs_on_error ERR

mkdir -p "$CARAPACE_STATE_DIR" "$SHARED_WORKSPACE"
entry="$(carapace_e2e_resolve_entrypoint)"
node "$entry" agents add alpha --workspace "$SHARED_WORKSPACE" --non-interactive
node "$entry" agents add ops --workspace "$SHARED_WORKSPACE" --non-interactive
gateway_pid="$(carapace_e2e_start_gateway "$entry" 18789 "$gateway_log")"
carapace_e2e_wait_gateway_ready "$gateway_pid" "$gateway_log" 300 18789

node "$entry" agents delete ops --force --json > "$output_file"
node "$entry" agents list --json > "$agents_file"

node scripts/e2e/lib/fixture.mjs agents-delete-assert "$output_file" "$agents_file"
'
