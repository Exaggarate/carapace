#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${CARAPACE_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
KITCHEN_SINK_ASSERTIONS="$(carapace_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs")"
IMAGE_NAME="$(docker_e2e_resolve_image "carapace-kitchen-sink-plugin-e2e" CARAPACE_KITCHEN_SINK_PLUGIN_E2E_IMAGE)"
CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES 65536
)"
CLAW_HUB_FIXTURE_WAIT_ATTEMPTS="$(
  docker_e2e_read_positive_int_env CARAPACE_CLAWHUB_FIXTURE_WAIT_ATTEMPTS 600
)"

CARAPACE_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 kitchen-sink-plugin empty)"
KITCHEN_SINK_NPM_SPEC="${CARAPACE_KITCHEN_SINK_NPM_SPEC:-npm:@carapace/kitchen-sink@latest}"
KITCHEN_SINK_NPM_MISSING_SPEC="${CARAPACE_KITCHEN_SINK_NPM_MISSING_SPEC:-npm:@carapace/kitchen-sink@beta}"

DEFAULT_KITCHEN_SINK_SCENARIOS="$(
  cat <<SCENARIOS
npm-latest-full|${KITCHEN_SINK_NPM_SPEC}|carapace-kitchen-sink-fixture|npm|success|full
npm-latest-conformance|${KITCHEN_SINK_NPM_SPEC}|carapace-kitchen-sink-fixture|npm|success|conformance|conformance
npm-latest-adversarial|${KITCHEN_SINK_NPM_SPEC}|carapace-kitchen-sink-fixture|npm|success|adversarial|adversarial
npm-beta|${KITCHEN_SINK_NPM_MISSING_SPEC}|carapace-kitchen-sink-fixture|npm|failure|none
clawhub-latest|clawhub:@carapace/kitchen-sink@latest|carapace-kitchen-sink-fixture|clawhub|success|basic
clawhub-beta|clawhub:@carapace/kitchen-sink@beta|carapace-kitchen-sink-fixture|clawhub|failure|none
npm-to-clawhub|clawhub:@carapace/kitchen-sink@latest|carapace-kitchen-sink-fixture|clawhub|success|basic||${KITCHEN_SINK_NPM_SPEC}
SCENARIOS
)"
KITCHEN_SINK_SCENARIOS="${CARAPACE_KITCHEN_SINK_PLUGIN_SCENARIOS:-$DEFAULT_KITCHEN_SINK_SCENARIOS}"
MAX_MEMORY_MIB="$(
  if [[ -n "${CARAPACE_KITCHEN_SINK_PLUGIN_MAX_MEMORY_MIB:-}" ]]; then
    docker_e2e_read_nonnegative_decimal_env CARAPACE_KITCHEN_SINK_PLUGIN_MAX_MEMORY_MIB 2304
  else
    docker_e2e_read_nonnegative_decimal_env CARAPACE_KITCHEN_SINK_MAX_MEMORY_MIB 2304
  fi
)"
MAX_CPU_PERCENT="$(docker_e2e_read_nonnegative_decimal_env CARAPACE_KITCHEN_SINK_MAX_CPU_PERCENT 1200)"
DOCKER_RUN_TIMEOUT="${CARAPACE_KITCHEN_SINK_PLUGIN_DOCKER_RUN_TIMEOUT:-1200s}"
KITCHEN_SINK_CLI_TIMEOUT="${CARAPACE_KITCHEN_SINK_PLUGIN_CLI_TIMEOUT:-${KITCHEN_SINK_CLI_TIMEOUT:-180s}}"
CONTAINER_NAME="carapace-kitchen-sink-plugin-e2e-$$"
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/carapace-kitchen-sink-plugin.XXXXXX")"
STATS_LOG="$(mktemp "${TMPDIR:-/tmp}/carapace-kitchen-sink-plugin-stats.XXXXXX")"

cleanup() {
  docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$RUN_LOG" "$STATS_LOG"
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" kitchen-sink-plugin

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "CARAPACE_CLAWHUB_FIXTURE_WAIT_ATTEMPTS=$CLAW_HUB_FIXTURE_WAIT_ATTEMPTS"
  -e "CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES=$CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES"
  -e "CARAPACE_TEST_STATE_SCRIPT_B64=$CARAPACE_TEST_STATE_SCRIPT_B64"
  -e "KITCHEN_SINK_SCENARIOS=$KITCHEN_SINK_SCENARIOS"
  -e "KITCHEN_SINK_CLI_TIMEOUT=$KITCHEN_SINK_CLI_TIMEOUT"
)
capability_status=0
carapace_resolve_frozen_plugin_harness_capabilities \
  "${CARAPACE_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" || capability_status=$?
[ "$capability_status" -eq 0 ] || exit "$capability_status"
carapace_append_frozen_plugin_harness_docker_env
if [[ "${CARAPACE_KITCHEN_SINK_LIVE_CLAWHUB:-0}" = "1" ]]; then
  for env_name in \
    CARAPACE_KITCHEN_SINK_LIVE_CLAWHUB \
    CARAPACE_CLAWHUB_URL \
    CLAWHUB_URL \
    CLAWHUB_TOKEN \
    CLAWHUB_AUTH_TOKEN; do
    env_value="${!env_name:-}"
    if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
      DOCKER_ENV_ARGS+=(-e "$env_name")
    fi
  done
fi

echo "Running kitchen-sink plugin Docker E2E..."
docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker_e2e_harness_mount_args
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run --name "$CONTAINER_NAME" "${DOCKER_E2E_HARNESS_ARGS[@]}" "${DOCKER_ENV_ARGS[@]}" -v "$KITCHEN_SINK_ASSERTIONS:/app/scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs:ro" -i "$IMAGE_NAME" bash scripts/e2e/lib/kitchen-sink-plugin/sweep.sh \
  >"$RUN_LOG" 2>&1 &
docker_pid="$!"

docker_e2e_sample_stats_until_exit \
  "$CONTAINER_NAME" \
  "$docker_pid" \
  "$STATS_LOG" \
  "$RUN_LOG" \
  "Kitchen-sink plugin Docker E2E" \
  "${CARAPACE_DOCKER_E2E_STATS_HEARTBEAT_SECONDS:-30}"

set +e
wait "$docker_pid"
run_status="$?"
set -e

docker_e2e_print_log "$RUN_LOG"

if [ "$run_status" -eq 0 ]; then
  node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink
elif [ -s "$STATS_LOG" ]; then
  if ! node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink; then
    echo "RESOURCE_CEILING_FAILED lane=kitchen-sink primary_status=$run_status" >&2
  fi
fi

exit "$run_status"
