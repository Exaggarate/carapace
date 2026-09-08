#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "carapace-codex-media-path-e2e" CARAPACE_CODEX_MEDIA_PATH_E2E_IMAGE)"
PORT="$(docker_e2e_read_tcp_port_env CARAPACE_CODEX_MEDIA_PATH_PORT 18790)"
TIMEOUT_SECONDS="$(docker_e2e_read_positive_int_env CARAPACE_CODEX_MEDIA_PATH_TIMEOUT_SECONDS 180)"
LOG_TAIL_MAX_BYTES="$(docker_e2e_read_positive_int_env CARAPACE_CODEX_MEDIA_PATH_LOG_TAIL_MAX_BYTES 2097152)"
TOKEN="codex-media-path-e2e-$$"
CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS=()
if [ -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  carapace_prepublish_plugin_registry_configure_docker_args \
    "$CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR"
fi

docker_e2e_build_or_reuse "$IMAGE_NAME" codex-media-path "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR"
CARAPACE_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 codex-media-path empty)"

echo "Running Codex media-path Docker E2E..."
docker_e2e_run_logged_with_harness codex-media-path \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e CARAPACE_CODEX_MEDIA_PATH_PLUGIN_SPEC \
  -e "CARAPACE_CODEX_MEDIA_PATH_LOG_TAIL_MAX_BYTES=$LOG_TAIL_MAX_BYTES" \
  -e "CARAPACE_CODEX_MEDIA_PATH_TIMEOUT_SECONDS=$TIMEOUT_SECONDS" \
  -e "CARAPACE_ALLOW_INSECURE_PRIVATE_WS=1" \
  -e "CARAPACE_GATEWAY_TOKEN=$TOKEN" \
  -e "CARAPACE_TEST_STATE_SCRIPT_B64=$CARAPACE_TEST_STATE_SCRIPT_B64" \
  -e "PORT=$PORT" \
  "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}" \
  -v "$ROOT_DIR/src:/app/src:ro" \
  -v "$ROOT_DIR/test/helpers:/app/test/helpers:ro" \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/codex-media-path/scenario.sh
