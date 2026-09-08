#!/usr/bin/env bash
# Installs a prepared Carapace npm tarball in Docker, runs non-interactive
# onboarding for a channel, and verifies one mocked model turn through Gateway.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${CARAPACE_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
ONBOARD_ASSERTIONS="$(carapace_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs")"

IMAGE_NAME="$(docker_e2e_resolve_image "carapace-npm-onboard-channel-agent-e2e" CARAPACE_NPM_ONBOARD_E2E_IMAGE)"
DOCKER_TARGET="${CARAPACE_NPM_ONBOARD_DOCKER_TARGET:-bare}"
HOST_BUILD="${CARAPACE_NPM_ONBOARD_HOST_BUILD:-1}"
PACKAGE_TGZ="${CARAPACE_CURRENT_PACKAGE_TGZ:-}"
CHANNEL="${CARAPACE_NPM_ONBOARD_CHANNEL:-telegram}"
USE_SOURCE_PLUGIN_PACKAGE="${CARAPACE_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}"
JSON_ARTIFACT_MAX_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_NPM_ONBOARD_JSON_ARTIFACT_MAX_BYTES 1048576
)"
STATUS_TEXT_MAX_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_NPM_ONBOARD_STATUS_TEXT_MAX_BYTES 1048576
)"
run_log=""

cleanup() {
  if [ -n "${PACKAGE_TGZ:-}" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "${run_log:-}" ]; then
    rm -f "$run_log"
  fi
}
trap cleanup EXIT

case "$CHANNEL" in
telegram | discord | slack) ;;
*)
  echo "CARAPACE_NPM_ONBOARD_CHANNEL must be telegram, discord, or slack, got: $CHANNEL" >&2
  exit 1
  ;;
esac

docker_e2e_build_or_reuse "$IMAGE_NAME" npm-onboard-channel-agent "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

prepare_package_tgz() {
  if [ -n "$PACKAGE_TGZ" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz npm-onboard-channel-agent "$PACKAGE_TGZ")"
    return 0
  fi
  if [ "$HOST_BUILD" = "0" ] && [ -z "${CARAPACE_CURRENT_PACKAGE_TGZ:-}" ]; then
    echo "CARAPACE_NPM_ONBOARD_HOST_BUILD=0 requires CARAPACE_CURRENT_PACKAGE_TGZ" >&2
    exit 1
  fi
  PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz npm-onboard-channel-agent)"
}

prepare_package_tgz

docker_e2e_package_mount_args "$PACKAGE_TGZ"
run_log="$(docker_e2e_run_log npm-onboard-channel-agent)"
CARAPACE_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 npm-onboard-channel-agent empty)"

echo "Running npm tarball onboard/channel/agent Docker E2E ($CHANNEL)..."
if ! docker_e2e_run_with_harness \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e CARAPACE_NPM_ONBOARD_CHANNEL="$CHANNEL" \
  -e CARAPACE_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE="$USE_SOURCE_PLUGIN_PACKAGE" \
  -e "CARAPACE_NPM_ONBOARD_JSON_ARTIFACT_MAX_BYTES=$JSON_ARTIFACT_MAX_BYTES" \
  -e "CARAPACE_NPM_ONBOARD_STATUS_TEXT_MAX_BYTES=$STATUS_TEXT_MAX_BYTES" \
  -e "CARAPACE_TEST_STATE_SCRIPT_B64=$CARAPACE_TEST_STATE_SCRIPT_B64" \
  -v "$ONBOARD_ASSERTIONS:/app/scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs:ro" \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -i "$IMAGE_NAME" bash -s >"$run_log" 2>&1 <<'EOF'; then
set -Eeuo pipefail

source scripts/lib/carapace-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_SCRIPT_B64:?missing CARAPACE_TEST_STATE_SCRIPT_B64}"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export OPENAI_API_KEY="sk-carapace-npm-onboard-e2e"
export CARAPACE_GATEWAY_TOKEN="npm-onboard-channel-agent-token"

CHANNEL="${CARAPACE_NPM_ONBOARD_CHANNEL:?missing CARAPACE_NPM_ONBOARD_CHANNEL}"
PORT="18789"
MOCK_PORT="44080"
SUCCESS_MARKER="CARAPACE_AGENT_E2E_OK_ASSISTANT"
scenario_tmp="$(mktemp -d "${TMPDIR:-/tmp}/carapace-npm-onboard-channel-agent.XXXXXX")"
MOCK_REQUEST_LOG="$scenario_tmp/mock-openai-requests.jsonl"
export SUCCESS_MARKER MOCK_REQUEST_LOG
mock_pid=""
plugin_registry_pid=""

case "$CHANNEL" in
  telegram)
    CHANNEL_TOKEN="123456:carapace-npm-onboard-token"
    DEP_SENTINEL="grammy"
    CHANNEL_ADD_ARGS=(--token "$CHANNEL_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$CHANNEL_TOKEN")
    ;;
  discord)
    CHANNEL_TOKEN="carapace-npm-onboard-discord-token"
    DEP_SENTINEL="discord-api-types"
    CHANNEL_ADD_ARGS=(--token "$CHANNEL_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$CHANNEL_TOKEN")
    ;;
  slack)
    SLACK_BOT_TOKEN="xoxb-carapace-npm-onboard-slack-token"
    SLACK_APP_TOKEN="xapp-carapace-npm-onboard-slack-token"
    DEP_SENTINEL="@slack/bolt"
    CHANNEL_ADD_ARGS=(--bot-token "$SLACK_BOT_TOKEN" --app-token "$SLACK_APP_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$SLACK_BOT_TOKEN" "$SLACK_APP_TOKEN")
    ;;
  *)
    echo "unsupported channel: $CHANNEL" >&2
    exit 1
    ;;
esac

cleanup() {
  carapace_e2e_stop_process "${mock_pid:-}"
  carapace_e2e_stop_process "${plugin_registry_pid:-}"
  rm -rf "$scenario_tmp"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "npm onboard/channel/agent scenario failed with exit code $status" >&2
  carapace_e2e_dump_logs \
    /tmp/carapace-install.log \
    /tmp/carapace-codex-plugin-install.log \
    /tmp/carapace-channel-plugin-install.log \
    /tmp/carapace-onboard.json \
    /tmp/carapace-channels-status.json \
    /tmp/carapace-channels-status.err \
    /tmp/carapace-status.txt \
    /tmp/carapace-status.err \
    /tmp/carapace-doctor.log \
    /tmp/carapace-agent.combined \
    /tmp/carapace-agent.err \
    /tmp/carapace-agent.json \
    /tmp/carapace-mock-openai.log \
    "$MOCK_REQUEST_LOG" \
    "$CARAPACE_HOME/.carapace/carapace.json" \
    "$CARAPACE_HOME/.carapace/agents/main/agent/auth-profiles.json"
}
trap 'status=$?; dump_debug_logs "$status"; exit "$status"' ERR

required_plugins='["@carapace/codex"]'
if [ "${CARAPACE_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}" = "1" ] && [ "$CHANNEL" != "telegram" ]; then
  if [ -z "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    echo "source channel fixture requires CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR with the matching candidate companion" >&2
    exit 1
  fi
  required_plugins="[\"@carapace/codex\",\"@carapace/$CHANNEL\"]"
fi
if [ -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  carapace_prepublish_plugin_registry_start_mounted \
    /tmp/carapace-npm-onboard-plugin-registry plugin_registry_pid "$required_plugins"
fi

carapace_e2e_install_package /tmp/carapace-install.log

command -v carapace >/dev/null
carapace_e2e_enable_carapace_cli_timeout
package_root="$(carapace_e2e_package_root)"
if [ -d "$package_root/dist/extensions/$CHANNEL" ]; then
  CHANNEL_PACKAGE_MODE="bundled"
else
  CHANNEL_PACKAGE_MODE="external"
  echo "$CHANNEL is not packaged with core Carapace; its plugin must be installed before channel configuration."
fi

# Older packages own their automatic setup; consent support, not a version,
# establishes whether this fixture must explicitly preinstall required plugins.
plugin_install_help="$(carapace plugins install --help)"
fixture_consent="$(printf '%s' "$plugin_install_help" | node scripts/e2e/lib/package-compat.mjs fixture-consent)"
if [ -n "$fixture_consent" ]; then
  codex_install_args=(codex)
  if [ -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    candidate_version="${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}"
    codex_install_args=("npm:@carapace/codex@$candidate_version" --pin)
  fi
  # Published packages use the official catalog's source selection;
  # mounted candidates use only the exact companion verified above.
  carapace_e2e_fixture_plugin_command carapace -- plugins install "${codex_install_args[@]}" \
    >/tmp/carapace-codex-plugin-install.log 2>&1
fi

mock_pid="$(carapace_e2e_start_mock_openai "$MOCK_PORT" /tmp/carapace-mock-openai.log)"
carapace_e2e_wait_mock_openai "$MOCK_PORT"

echo "Running non-interactive onboarding..."
carapace onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice openai-api-key \
  --secret-input-mode ref \
  --gateway-port "$PORT" \
  --gateway-bind loopback \
  --skip-daemon \
  --skip-ui \
  --skip-skills \
  --skip-health \
  --json >/tmp/carapace-onboard.json

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-onboard-state "$HOME"

carapace_e2e_assert_dep_absent "$DEP_SENTINEL" "$HOME/.carapace"

if [ "$CHANNEL_PACKAGE_MODE" = "external" ] && [ -n "$fixture_consent" ]; then
  channel_install_args=("$CHANNEL")
  if [ "${CARAPACE_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}" = "1" ] && [ "$CHANNEL" != "telegram" ]; then
    # The verified registry preserves candidate bytes through the official npm
    # installer; a local archive would not establish official plugin provenance.
    channel_install_args=("npm:@carapace/$CHANNEL@$candidate_version" --pin)
  fi
  carapace_e2e_fixture_plugin_command carapace -- plugins install "${channel_install_args[@]}" \
    >/tmp/carapace-channel-plugin-install.log 2>&1
fi

echo "Configuring $CHANNEL..."
carapace_e2e_run_logged channel-add "$CARAPACE_E2E_CLI_BIN" channels add --channel "$CHANNEL" "${CHANNEL_ADD_ARGS[@]}"
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-channel-config "$CHANNEL" "${CHANNEL_CONFIG_TOKENS[@]}"

echo "Checking status surfaces for $CHANNEL..."
carapace channels status --json >/tmp/carapace-channels-status.json 2>/tmp/carapace-channels-status.err
carapace status >/tmp/carapace-status.txt 2>/tmp/carapace-status.err
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-status-surfaces "$CHANNEL" /tmp/carapace-channels-status.json /tmp/carapace-status.txt

echo "Running doctor after channel activation..."
carapace doctor --repair --non-interactive >/tmp/carapace-doctor.log 2>&1
if [ "$CHANNEL_PACKAGE_MODE" = "external" ]; then
  carapace_e2e_assert_dep_present "$DEP_SENTINEL" "$HOME/.carapace"
else
  carapace_e2e_assert_dep_absent "$DEP_SENTINEL" "$HOME/.carapace"
fi

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs configure-mock-model "$MOCK_PORT"
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-mock-model-config "$MOCK_PORT"

echo "Running local agent turn against mocked OpenAI..."
if carapace agent --local \
  --agent main \
  --session-id npm-onboard-channel-agent \
  --message "Return the success marker from the test server." \
  --thinking off \
  --json >/tmp/carapace-agent.combined 2>&1; then
  agent_status=0
else
  agent_status=$?
fi
if [ "$agent_status" -ne 0 ]; then
  dump_debug_logs "$agent_status"
  exit "$agent_status"
fi

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-agent-turn "$SUCCESS_MARKER" "$MOCK_REQUEST_LOG"

echo "npm tarball onboard/channel/agent Docker E2E passed for $CHANNEL"
EOF
  docker_e2e_print_log "$run_log"
  exit 1
fi

echo "npm tarball onboard/channel/agent Docker E2E passed ($CHANNEL)"
