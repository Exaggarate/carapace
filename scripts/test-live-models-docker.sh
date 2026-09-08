#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${CARAPACE_LIVE_DOCKER_REPO_ROOT:-$SCRIPT_ROOT_DIR}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
TRUSTED_HARNESS_DIR="${CARAPACE_LIVE_DOCKER_TRUSTED_HARNESS_DIR:-$SCRIPT_ROOT_DIR}"
if [[ -z "$TRUSTED_HARNESS_DIR" || ! -d "$TRUSTED_HARNESS_DIR" ]]; then
  echo "ERROR: trusted live Docker harness directory not found: ${TRUSTED_HARNESS_DIR:-<empty>}." >&2
  exit 1
fi
TRUSTED_HARNESS_DIR="$(cd "$TRUSTED_HARNESS_DIR" && pwd)"
source "$TRUSTED_HARNESS_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${CARAPACE_IMAGE:-carapace:local}"
LIVE_IMAGE_NAME="${CARAPACE_LIVE_IMAGE:-${IMAGE_NAME}-live}"
PROFILE_FILE="$(carapace_live_default_profile_file)"
DOCKER_AUTH_PRESTAGED=0
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)

LIVE_MAX_MODELS="${CARAPACE_LIVE_MAX_MODELS:-}"
if [[ -n "$LIVE_MAX_MODELS" && ! "$LIVE_MAX_MODELS" =~ ^\+?[0-9]+$ ]]; then
  echo "invalid CARAPACE_LIVE_MAX_MODELS: $LIVE_MAX_MODELS" >&2
  exit 2
fi
LIVE_MODEL_TIMEOUT_MS="${CARAPACE_LIVE_MODEL_TIMEOUT_MS:-}"
if [[ -n "$LIVE_MODEL_TIMEOUT_MS" ]]; then
  LIVE_MODEL_TIMEOUT_MS="$(carapace_live_read_positive_int_env CARAPACE_LIVE_MODEL_TIMEOUT_MS "$LIVE_MODEL_TIMEOUT_MS")"
fi
carapace_live_init_temp_dirs

if carapace_live_truthy "${CARAPACE_DOCKER_PROFILE_ENV_ONLY:-}"; then
  CONFIG_DIR="$(mktemp -d)"
  WORKSPACE_DIR="$(mktemp -d)"
  TEMP_DIRS+=("$CONFIG_DIR" "$WORKSPACE_DIR")
  CARAPACE_DOCKER_AUTH_DIRS=none
else
  CONFIG_DIR="${CARAPACE_CONFIG_DIR:-$HOME/.carapace}"
  WORKSPACE_DIR="${CARAPACE_WORKSPACE_DIR:-$HOME/.carapace/workspace}"
fi
carapace_live_init_cache_home_dir
carapace_live_init_managed_home
carapace_live_init_profile_mount

carapace_live_collect_auth_for_providers "${CARAPACE_LIVE_PROVIDERS:-},${CARAPACE_LIVE_GATEWAY_PROVIDERS:-}"
carapace_live_finalize_auth_mounts

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export COREPACK_HOME="${COREPACK_HOME:-$XDG_CACHE_HOME/node/corepack}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
mkdir -p "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
tmp_dir="$(mktemp -d)"
trusted_scripts_dir="${CARAPACE_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
carapace_live_stage_mounted_auth
carapace_live_stage_source_tree "$tmp_dir"
carapace_live_stage_node_modules "$tmp_dir"
carapace_live_link_runtime_tree "$tmp_dir"
carapace_live_stage_state_dir "$tmp_dir/.carapace-state"
carapace_live_prepare_staged_config
cd "$tmp_dir"
carapace_live_run_staged_script scripts/test-live -- src/agents/models.profiles.live.test.ts
EOF

CARAPACE_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR" "$TRUSTED_HARNESS_DIR/scripts/test-live-build-docker.sh"
if carapace_live_uses_managed_bind_dirs; then
  carapace_live_chown_bind_dirs_for_container_user \
    "$LIVE_IMAGE_NAME" \
    "$DOCKER_USER" \
    "$CACHE_HOME_DIR" \
    "${DOCKER_HOME_DIR:-}"
fi

echo "==> Run live model tests (profile keys)"
echo "==> Target: src/agents/models.profiles.live.test.ts"
echo "==> Profile env only: ${CARAPACE_DOCKER_PROFILE_ENV_ONLY:-0}"
echo "==> Profile file: $PROFILE_STATUS"
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
echo "==> External auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_RUN_ARGS=()
carapace_live_init_docker_run_args DOCKER_RUN_ARGS "${CARAPACE_LIVE_MODELS_DOCKER_RUN_TIMEOUT:-2100s}"
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS="$(carapace_live_container_node_options)" \
  -e CARAPACE_SKIP_CHANNELS=1 \
  -e CARAPACE_SUPPRESS_NOTES=1 \
  -e CARAPACE_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e CARAPACE_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e CARAPACE_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e CARAPACE_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e CARAPACE_LIVE_DOCKER_SOURCE_STAGE_MODE="${CARAPACE_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e CARAPACE_LIVE_TEST=1 \
  -e CARAPACE_LIVE_MODELS="${CARAPACE_LIVE_MODELS:-modern}" \
  -e CARAPACE_LIVE_PROVIDERS="${CARAPACE_LIVE_PROVIDERS:-}" \
  -e CARAPACE_LIVE_MAX_MODELS="$LIVE_MAX_MODELS" \
  -e CARAPACE_LIVE_MODEL_TIMEOUT_MS="$LIVE_MODEL_TIMEOUT_MS" \
  -e CARAPACE_LIVE_REQUIRE_PROFILE_KEYS="${CARAPACE_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -e CARAPACE_LIVE_GATEWAY_MODELS="${CARAPACE_LIVE_GATEWAY_MODELS:-}" \
  -e CARAPACE_LIVE_GATEWAY_PROVIDERS="${CARAPACE_LIVE_GATEWAY_PROVIDERS:-}" \
  -e CARAPACE_LIVE_GATEWAY_MAX_MODELS="${CARAPACE_LIVE_GATEWAY_MAX_MODELS:-}" \
  -e CARAPACE_VITEST_FS_MODULE_CACHE=0)
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.carapace \
  -v "$WORKSPACE_DIR":/home/node/.carapace/workspace)
carapace_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
carapace_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
