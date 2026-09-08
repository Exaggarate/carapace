#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${CARAPACE_LIVE_DOCKER_REPO_ROOT:-$SCRIPT_ROOT_DIR}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
TRUSTED_HARNESS_DIR="${CARAPACE_LIVE_DOCKER_TRUSTED_HARNESS_DIR:-${CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR:-$SCRIPT_ROOT_DIR}}"
if [[ -z "$TRUSTED_HARNESS_DIR" || ! -d "$TRUSTED_HARNESS_DIR" ]]; then
  echo "ERROR: trusted Codex harness directory not found: ${TRUSTED_HARNESS_DIR:-<empty>}." >&2
  exit 1
fi
TRUSTED_HARNESS_DIR="$(cd "$TRUSTED_HARNESS_DIR" && pwd)"
source "$TRUSTED_HARNESS_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${CARAPACE_IMAGE:-carapace:local}"
LIVE_IMAGE_NAME="${CARAPACE_LIVE_IMAGE:-${IMAGE_NAME}-live}"
CONFIG_DIR="${CARAPACE_CONFIG_DIR:-$HOME/.carapace}"
WORKSPACE_DIR="${CARAPACE_WORKSPACE_DIR:-$HOME/.carapace/workspace}"
PROFILE_FILE="$(carapace_live_default_profile_file)"
CODEX_HARNESS_AUTH_MODE="${CARAPACE_LIVE_CODEX_HARNESS_AUTH:-codex-auth}"
CODEX_CLI_PACKAGE_SPEC="${CARAPACE_LIVE_CODEX_CLI_PACKAGE_SPEC:-}"
CODEX_HARNESS_SETUP_TIMEOUT_SECONDS="$(carapace_live_read_positive_int_env CARAPACE_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS 180)"
CODEX_HARNESS_TARGET_COUNT=1
if [[ -n "${CARAPACE_LIVE_CODEX_HARNESS_TARGETS:-}" ]]; then
  IFS=',' read -r -a CODEX_HARNESS_TARGET_ITEMS <<<"$CARAPACE_LIVE_CODEX_HARNESS_TARGETS"
  CODEX_HARNESS_TARGET_COUNT="${#CODEX_HARNESS_TARGET_ITEMS[@]}"
fi
# Each target starts an isolated 15-minute Vitest suite. Preserve the old
# 35-minute single-target budget while scaling matrix runs linearly.
CODEX_HARNESS_DOCKER_RUN_TIMEOUT="${CARAPACE_LIVE_CODEX_HARNESS_DOCKER_RUN_TIMEOUT:-$((2100 * CODEX_HARNESS_TARGET_COUNT))s}"
DOCKER_TRUSTED_HARNESS_MOUNT=()
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR=""
DOCKER_CACHE_CONTAINER_DIR="/tmp/carapace-cache"
DOCKER_CLI_TOOLS_CONTAINER_DIR="/tmp/carapace-npm-global"
DOCKER_EXTRA_ENV_FILES=()
DOCKER_AUTH_PRESTAGED=0

carapace_live_codex_harness_append_build_extension() {
  local extension="${1:?extension required}"
  local current="${CARAPACE_DOCKER_BUILD_EXTENSIONS:-${CARAPACE_EXTENSIONS:-}}"
  case " $current " in
    *" $extension "*)
      ;;
    *)
      export CARAPACE_DOCKER_BUILD_EXTENSIONS="${current:+$current }$extension"
      ;;
  esac
}

case "$CODEX_HARNESS_AUTH_MODE" in
  codex-auth | api-key)
    ;;
  *)
    echo "ERROR: CARAPACE_LIVE_CODEX_HARNESS_AUTH must be one of: codex-auth, api-key." >&2
    exit 1
    ;;
esac

if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROFILE_FILE"
  set +a
fi

if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: CARAPACE_LIVE_CODEX_HARNESS_AUTH=api-key requires OPENAI_API_KEY." >&2
  exit 1
fi
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" && ! -s "$HOME/.codex/auth.json" ]]; then
  echo "ERROR: CARAPACE_LIVE_CODEX_HARNESS_AUTH=codex-auth requires ~/.codex/auth.json before building the live Docker image." >&2
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "If this is a Testbox/API-key run, set CARAPACE_LIVE_CODEX_HARNESS_AUTH=api-key and run through carapace-testbox-env." >&2
  fi
  exit 1
fi
if [[ -z "$CODEX_CLI_PACKAGE_SPEC" ]]; then
  CODEX_CLI_PACKAGE_SPEC="$(
    node -e '
      const pkg = require(process.argv[1]);
      const version = pkg.dependencies?.["@openai/codex"];
      if (!version || typeof version !== "string") process.exit(1);
      process.stdout.write(`@openai/codex@${version}`);
    ' "$ROOT_DIR/extensions/codex/package.json"
  )"
fi

carapace_live_init_temp_dirs
carapace_live_init_cli_tools_dir
carapace_live_init_cache_home_dir
carapace_live_init_managed_home
if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  if [[ -z "${DOCKER_HOME_DIR:-}" ]]; then
    DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/carapace-docker-home.XXXXXX")"
    TEMP_DIRS+=("$DOCKER_HOME_DIR")
    carapace_live_prepare_bind_dir_for_container_user "$DOCKER_HOME_DIR"
    DOCKER_HOME_MOUNT=(-v "$DOCKER_HOME_DIR":/home/node)
  fi
  CONFIG_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/carapace-docker-config.XXXXXX")"
  WORKSPACE_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/carapace-docker-workspace.XXXXXX")"
  TEMP_DIRS+=("$CONFIG_DIR" "$WORKSPACE_DIR")
  chmod 0777 "$DOCKER_HOME_DIR" "$CONFIG_DIR" "$WORKSPACE_DIR" || true
  DOCKER_CACHE_CONTAINER_DIR="/home/node/.cache"
  DOCKER_CLI_TOOLS_CONTAINER_DIR="/home/node/.npm-global"
fi

if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  PROFILE_MOUNT=()
  PROFILE_STATUS="api-key-env"
else
  carapace_live_init_profile_mount
fi

DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)

AUTH_FILES=()
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" ]]; then
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(carapace_live_collect_auth_files_from_csv "openai")
fi

AUTH_DIRS=()
carapace_live_finalize_auth_mounts

DOCKER_AUTH_ENV=()
if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  docker_env_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/carapace-codex-harness-env.XXXXXX")"
  TEMP_DIRS+=("$docker_env_dir")
  docker_env_file="$docker_env_dir/openai.env"
  {
    printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    printf 'CODEX_API_KEY=%s\n' "${CODEX_API_KEY:-$OPENAI_API_KEY}"
    if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
      printf 'OPENAI_BASE_URL=%s\n' "${OPENAI_BASE_URL}"
    fi
  } >"$docker_env_file"
  DOCKER_EXTRA_ENV_FILES+=(--env-file "$docker_env_file")
fi

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export COREPACK_HOME="${COREPACK_HOME:-$XDG_CACHE_HOME/node/corepack}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
cleanup_codex_live_mounts() {
  chmod -R a+rwX "$HOME" "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" 2>/dev/null || true
}
trap cleanup_codex_live_mounts EXIT
if [ "${CARAPACE_LIVE_CODEX_HARNESS_DEBUG:-}" = "1" ]; then
  id
  mount | grep -E 'carapace-cache|carapace-npm|/home/node' || true
  ls -ld "$HOME" "$XDG_CACHE_HOME" "$NPM_CONFIG_PREFIX" 2>/dev/null || true
fi
# Force the Codex harness to use the staged `~/.codex` auth files. This lane
# is not meant to exercise raw OpenAI API-key routing unless the lane
# explicitly opts into API-key auth for CI.
if [ "${CARAPACE_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ]; then
  unset OPENAI_API_KEY OPENAI_BASE_URL
fi
mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
trusted_scripts_dir="${CARAPACE_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
carapace_live_stage_mounted_auth
run_setup_command() {
  carapace_live_run_setup_command \
    "${CARAPACE_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS:?missing live Codex harness setup timeout seconds}" \
    "live Codex harness setup" \
    "$@"
}
if [ "${CARAPACE_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ] && [ ! -s "$HOME/.codex/auth.json" ]; then
  echo "ERROR: missing ~/.codex/auth.json for Codex harness live test." >&2
  exit 1
fi
if [ "${CARAPACE_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ]; then
  node --import tsx "$trusted_scripts_dir/prepare-codex-ci-auth.ts" "$HOME/.codex/auth.json"
fi
run_setup_command npm install -g "$CARAPACE_LIVE_CODEX_CLI_PACKAGE_SPEC"
"$NPM_CONFIG_PREFIX/bin/codex" --version
if [ "${CARAPACE_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" = "api-key" ]; then
  printf '%s\n' "$OPENAI_API_KEY" | "$NPM_CONFIG_PREFIX/bin/codex" login --with-api-key >/dev/null
fi
tmp_dir="$(mktemp -d)"
carapace_live_stage_source_tree "$tmp_dir"
carapace_live_stage_node_modules "$tmp_dir"
carapace_live_link_runtime_tree "$tmp_dir"
if [ ! -f "$tmp_dir/extensions/codex/carapace.plugin.json" ]; then
  echo "ERROR: staged Codex plugin not found for live harness." >&2
  exit 1
fi
# Source Gateway and plugin must share one prepared-runtime owner; built artifacts own a
# separate lifecycle and are validated by the packaged-plugin Docker lane instead.
export CARAPACE_BUNDLED_PLUGINS_DIR="$tmp_dir/extensions"
carapace_live_stage_state_dir "$tmp_dir/.carapace-state"
if [ -n "${CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR:-}" ] && [ -d "$CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR" ]; then
  for harness_file in src/gateway/gateway-codex-harness.live-helpers.ts; do
    if [ -f "$CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR/$harness_file" ]; then
      mkdir -p "$(dirname "$tmp_dir/$harness_file")"
      cp "$CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR/$harness_file" "$tmp_dir/$harness_file"
    fi
  done
fi
carapace_live_prepare_staged_config
cd "$tmp_dir"
if [ "${CARAPACE_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}" = "1" ]; then
  node --import tsx "$trusted_scripts_dir/prepare-codex-ci-config.ts" "$HOME/.codex/config.toml" "$tmp_dir"
fi
codex_preflight_log="$tmp_dir/codex-preflight.log"
codex_preflight_token="CODEX-PREFLIGHT-OK"
if ! "$NPM_CONFIG_PREFIX/bin/codex" exec \
  --json \
  --color never \
  --skip-git-repo-check \
  "Reply exactly: $codex_preflight_token" >"$codex_preflight_log" 2>&1; then
  if grep -q "Failed to extract accountId from token" "$codex_preflight_log"; then
    echo "ERROR: Codex auth cannot extract accountId from the available token; refresh CARAPACE_CODEX_AUTH_JSON or use CARAPACE_LIVE_CODEX_HARNESS_AUTH=api-key." >&2
    exit 1
  fi
  tail -c 262144 "$codex_preflight_log" >&2 || true
  exit 1
fi
run_codex_harness_target() {
  local model="${1:?model required}"
  local thinking="${2:?thinking required}"
  export CARAPACE_LIVE_CODEX_HARNESS_MODEL="$model"
  export CARAPACE_LIVE_CODEX_HARNESS_THINKING="$thinking"
  echo "==> Codex harness target: model=$model thinking=$thinking"
  carapace_live_run_staged_script scripts/test-live -- ${CARAPACE_LIVE_CODEX_TEST_FILES:-src/gateway/gateway-codex-harness.live.test.ts}
}
if [ -n "${CARAPACE_LIVE_CODEX_HARNESS_TARGETS:-}" ]; then
  IFS=',' read -r -a harness_targets <<<"$CARAPACE_LIVE_CODEX_HARNESS_TARGETS"
  for harness_target in "${harness_targets[@]}"; do
    model="${harness_target%%=*}"
    thinking="${harness_target##*=}"
    if [ -z "$model" ] || [ -z "$thinking" ] || [ "$model" = "$thinking" ]; then
      echo "ERROR: invalid Codex harness target '$harness_target'; expected provider/model=thinking." >&2
      exit 1
    fi
    run_codex_harness_target "$model" "$thinking"
  done
else
  run_codex_harness_target \
    "${CARAPACE_LIVE_CODEX_HARNESS_MODEL:-openai/gpt-5.6-luna}" \
    "${CARAPACE_LIVE_CODEX_HARNESS_THINKING:-low}"
fi
EOF

carapace_live_codex_harness_append_build_extension codex
# The release package image intentionally excludes externalized plugins such as
# Codex. This lane must rebuild the live image so the plugin-owned harness is
# present under the bundled plugin runtime directory.
CARAPACE_SKIP_DOCKER_BUILD=0
export CARAPACE_SKIP_DOCKER_BUILD
CARAPACE_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR" "$TRUSTED_HARNESS_DIR/scripts/test-live-build-docker.sh"
if carapace_live_uses_managed_bind_dirs; then
  carapace_live_chown_bind_dirs_for_container_user \
    "$LIVE_IMAGE_NAME" \
    "$DOCKER_USER" \
    "$CLI_TOOLS_DIR" \
    "$CACHE_HOME_DIR" \
    "$CONFIG_DIR" \
    "$WORKSPACE_DIR" \
    "${DOCKER_HOME_DIR:-}"
fi

echo "==> Run Codex harness live test in Docker"
echo "==> Model: ${CARAPACE_LIVE_CODEX_HARNESS_MODEL:-openai/gpt-5.6-luna}"
echo "==> Thinking: ${CARAPACE_LIVE_CODEX_HARNESS_THINKING:-low}"
echo "==> Expected native effort: ${CARAPACE_LIVE_CODEX_HARNESS_EXPECTED_EFFORT:-auto}"
echo "==> Targets: ${CARAPACE_LIVE_CODEX_HARNESS_TARGETS:-single model}"
echo "==> Target count: $CODEX_HARNESS_TARGET_COUNT"
echo "==> Docker run timeout: $CODEX_HARNESS_DOCKER_RUN_TIMEOUT"
echo "==> Chat image probe: ${CARAPACE_LIVE_CODEX_HARNESS_CHAT_IMAGE_PROBE:-0}"
echo "==> Image probe: ${CARAPACE_LIVE_CODEX_HARNESS_IMAGE_PROBE:-1}"
echo "==> MCP probe: ${CARAPACE_LIVE_CODEX_HARNESS_MCP_PROBE:-1}"
echo "==> Multi-session probe: ${CARAPACE_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE:-0}"
echo "==> Subagent probe: ${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_PROBE:-1}"
echo "==> Subagent count: ${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_COUNT:-1}"
echo "==> Subagent-only fast path: ${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_ONLY:-auto}"
echo "==> Guardian probe: ${CARAPACE_LIVE_CODEX_HARNESS_GUARDIAN_PROBE:-1}"
echo "==> Code-mode-only probe: ${CARAPACE_LIVE_CODEX_HARNESS_CODE_MODE_ONLY:-0}"
echo "==> Loop relay disabled: ${CARAPACE_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY:-0}"
echo "==> Resume stress: ${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS:-0}"
echo "==> Resume stress history turns: ${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS:-4}"
echo "==> Resume stress restarts: ${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS:-3}"
echo "==> Compaction stress: ${CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS:-0}"
echo "==> Compaction stress turns: ${CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS:-4}"
echo "==> Large output bytes: ${CARAPACE_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES:-300000}"
echo "==> Auth mode: $CODEX_HARNESS_AUTH_MODE"
echo "==> Profile file: $PROFILE_STATUS"
echo "==> CI-safe Codex config: ${CARAPACE_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}"
echo "==> Test files: ${CARAPACE_LIVE_CODEX_TEST_FILES:-src/gateway/gateway-codex-harness.live.test.ts}"
echo "==> Codex CLI package: $CODEX_CLI_PACKAGE_SPEC"
echo "==> Harness fallback: none"
echo "==> Auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_RUN_ARGS=()
carapace_live_init_docker_run_args DOCKER_RUN_ARGS "$CODEX_HARNESS_DOCKER_RUN_TIMEOUT"
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NPM_CONFIG_PREFIX="$DOCKER_CLI_TOOLS_CONTAINER_DIR" \
  -e npm_config_prefix="$DOCKER_CLI_TOOLS_CONTAINER_DIR" \
  -e XDG_CACHE_HOME="$DOCKER_CACHE_CONTAINER_DIR" \
  -e COREPACK_HOME="$DOCKER_CACHE_CONTAINER_DIR/node/corepack" \
  -e NPM_CONFIG_CACHE="$DOCKER_CACHE_CONTAINER_DIR/npm" \
  -e npm_config_cache="$DOCKER_CACHE_CONTAINER_DIR/npm" \
  -e NODE_OPTIONS="$(carapace_live_container_node_options)" \
  -e CARAPACE_AGENT_HARNESS_FALLBACK=none \
  -e CARAPACE_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e CARAPACE_CODEX_APP_SERVER_BIN="${CARAPACE_CODEX_APP_SERVER_BIN:-codex}" \
  -e CARAPACE_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e CARAPACE_LIVE_DOCKER_SOURCE_STAGE_MODE="${CARAPACE_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_AUTH="$CODEX_HARNESS_AUTH_MODE" \
  -e CARAPACE_LIVE_CODEX_HARNESS=1 \
  -e CARAPACE_LIVE_CODEX_HARNESS_CHAT_IMAGE_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_CHAT_IMAGE_PROBE:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_CODE_MODE_ONLY="${CARAPACE_LIVE_CODEX_HARNESS_CODE_MODE_ONLY:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS="${CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS="${CARAPACE_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS:-4}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_DEBUG="${CARAPACE_LIVE_CODEX_HARNESS_DEBUG:-}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY="${CARAPACE_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_GUARDIAN_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_GUARDIAN_PROBE:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_IMAGE_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_IMAGE_PROBE:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES="${CARAPACE_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES:-300000}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_MCP_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_MCP_PROBE:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_MODEL="${CARAPACE_LIVE_CODEX_HARNESS_MODEL:-openai/gpt-5.6-luna}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_TARGETS="${CARAPACE_LIVE_CODEX_HARNESS_TARGETS:-}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_THINKING="${CARAPACE_LIVE_CODEX_HARNESS_THINKING:-low}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_EXPECTED_EFFORT="${CARAPACE_LIVE_CODEX_HARNESS_EXPECTED_EFFORT:-}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_REQUIRE_GUARDIAN_EVENTS="${CARAPACE_LIVE_CODEX_HARNESS_REQUIRE_GUARDIAN_EVENTS:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_REQUEST_TIMEOUT_MS="${CARAPACE_LIVE_CODEX_HARNESS_REQUEST_TIMEOUT_MS:-}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS="${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS:-0}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS="${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS:-4}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS="${CARAPACE_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS:-3}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS="$CODEX_HARNESS_SETUP_TIMEOUT_SECONDS" \
  -e CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_ONLY="${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_ONLY:-}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_COUNT="${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_COUNT:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_PROBE="${CARAPACE_LIVE_CODEX_HARNESS_SUBAGENT_PROBE:-1}" \
  -e CARAPACE_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG="${CARAPACE_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}" \
  -e CARAPACE_LIVE_CODEX_CLI_PACKAGE_SPEC="$CODEX_CLI_PACKAGE_SPEC" \
  -e CARAPACE_CLI_BACKEND_LOG_OUTPUT="${CARAPACE_CLI_BACKEND_LOG_OUTPUT:-}" \
  -e CARAPACE_TEST_CONSOLE="${CARAPACE_TEST_CONSOLE:-}" \
  -e CARAPACE_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e CARAPACE_LIVE_DOCKER_TRUSTED_HARNESS_DIR="$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR" \
  -e CARAPACE_LIVE_CODEX_TRUSTED_HARNESS_DIR="$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR" \
  -e CARAPACE_LIVE_CODEX_BIND="${CARAPACE_LIVE_CODEX_BIND:-}" \
  -e CARAPACE_LIVE_CODEX_BIND_MODEL="${CARAPACE_LIVE_CODEX_BIND_MODEL:-}" \
  -e CARAPACE_LIVE_CODEX_BIND_PROVIDER="${CARAPACE_LIVE_CODEX_BIND_PROVIDER:-}" \
  -e CARAPACE_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS="${CARAPACE_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS:-}" \
  -e CARAPACE_LIVE_CODEX_BIND_TIMEOUT_MS="${CARAPACE_LIVE_CODEX_BIND_TIMEOUT_MS:-}" \
  -e CARAPACE_LIVE_CODEX_TEST_FILES="${CARAPACE_LIVE_CODEX_TEST_FILES:-}" \
  -e CARAPACE_LIVE_TEST=1 \
  -e CARAPACE_VITEST_FS_MODULE_CACHE=0)
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_AUTH_ENV
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_EXTRA_ENV_FILES
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
carapace_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.carapace \
  -v "$WORKSPACE_DIR":/home/node/.carapace/workspace)
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" ]]; then
  DOCKER_RUN_ARGS+=(\
    -v "$CACHE_HOME_DIR":"$DOCKER_CACHE_CONTAINER_DIR" \
    -v "$CLI_TOOLS_DIR":"$DOCKER_CLI_TOOLS_CONTAINER_DIR")
fi
carapace_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
carapace_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
if [[ "${CARAPACE_LIVE_CODEX_HARNESS_DEBUG:-}" == "1" ]]; then
  echo "==> Docker debug: host ids and mounted dirs"
  id
  ls -ld "$CACHE_HOME_DIR" "$CLI_TOOLS_DIR" "${DOCKER_HOME_DIR:-$HOME}" 2>/dev/null || true
  printf '==> Docker debug args:'
  printf ' %q' "${DOCKER_RUN_ARGS[@]}"
  printf '\n'
fi
"${DOCKER_RUN_ARGS[@]}"
