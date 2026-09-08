#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"
SOURCE_ROOT="${CARAPACE_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
IMAGE_NAME="$(docker_e2e_resolve_image "carapace-plugins-e2e" CARAPACE_PLUGINS_E2E_IMAGE)"
CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES 65536
)"
CLAW_HUB_PREFLIGHT_BODY_MAX_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_PLUGINS_E2E_CLAWHUB_PREFLIGHT_BODY_MAX_BYTES 1048576
)"
CLAW_HUB_PREFLIGHT_TIMEOUT_MS="$(
  docker_e2e_read_positive_int_env CARAPACE_PLUGINS_E2E_CLAWHUB_PREFLIGHT_TIMEOUT_MS 30000
)"
PLUGINS_CLI_TIMEOUT="${CARAPACE_PLUGINS_CLI_TIMEOUT:-180s}"

carapace_resolve_frozen_plugin_harness_capabilities "$SOURCE_ROOT"

docker_e2e_build_or_reuse "$IMAGE_NAME" plugins

CARAPACE_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 plugins empty)"
DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES=$CARAPACE_DOCKER_E2E_LOG_PRINT_BYTES"
  -e "CARAPACE_PLUGINS_E2E_CLAWHUB_PREFLIGHT_BODY_MAX_BYTES=$CLAW_HUB_PREFLIGHT_BODY_MAX_BYTES"
  -e "CARAPACE_PLUGINS_E2E_CLAWHUB_PREFLIGHT_TIMEOUT_MS=$CLAW_HUB_PREFLIGHT_TIMEOUT_MS"
  -e "CARAPACE_PLUGINS_CLI_TIMEOUT=$PLUGINS_CLI_TIMEOUT"
  -e "CARAPACE_TEST_STATE_SCRIPT_B64=$CARAPACE_TEST_STATE_SCRIPT_B64"
)
carapace_append_frozen_plugin_harness_docker_env
for env_name in \
  CARAPACE_PLUGIN_LIFECYCLE_TRACE \
  CARAPACE_PLUGINS_E2E_CLAWHUB \
  CARAPACE_PLUGINS_E2E_LIVE_CLAWHUB \
  CARAPACE_PLUGINS_E2E_CLAWHUB_SPEC \
  CARAPACE_PLUGINS_E2E_CLAWHUB_ID; do
  env_value="${!env_name:-}"
  if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
    DOCKER_ENV_ARGS+=(-e "$env_name")
  fi
done
if [[ "${CARAPACE_PLUGINS_E2E_LIVE_CLAWHUB:-0}" = "1" ]]; then
  for env_name in \
    CARAPACE_CLAWHUB_URL \
    CLAWHUB_URL \
    CLAWHUB_TOKEN \
    CLAWHUB_AUTH_TOKEN \
    CARAPACE_PLUGINS_E2E_LIVE_NPM_REGISTRY; do
    env_value="${!env_name:-}"
    if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
      DOCKER_ENV_ARGS+=(-e "$env_name")
    fi
  done
fi

echo "Running plugins Docker E2E..."
docker_e2e_run_logged_print_with_harness \
  plugins-run \
  "${DOCKER_ENV_ARGS[@]}" \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/plugins/sweep.sh

echo "OK"
