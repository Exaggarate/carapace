#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-build.sh"
source "$ROOT_DIR/scripts/lib/docker-e2e-container.sh"
IMAGE_NAME="${CARAPACE_INSTALL_E2E_IMAGE:-carapace-install-e2e:local}"
INSTALL_URL="${CARAPACE_INSTALL_URL:-https://carapace.bot/install.sh}"
DOCKER_COMMAND_TIMEOUT="${DOCKER_COMMAND_TIMEOUT:-${CARAPACE_INSTALL_E2E_DOCKER_TIMEOUT:-2700s}}"
PROFILE_FILE="${CARAPACE_INSTALL_E2E_PROFILE_FILE:-${CARAPACE_PROFILE_FILE:-${CARAPACE_TESTBOX_PROFILE_FILE:-$HOME/.carapace-testbox-live.profile}}}"

OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_API_TOKEN="${ANTHROPIC_API_TOKEN:-}"
CARAPACE_E2E_MODELS="${CARAPACE_E2E_MODELS:-}"

read_boolean_env() {
  local name="${1:?missing environment variable name}"
  local fallback="${2:?missing fallback value}"
  local value="${!name-}"
  if [ -z "${!name+x}" ]; then
    value="$fallback"
  fi
  case "$value" in
    0 | 1)
      printf "%s\n" "$value"
      ;;
    *)
      echo "invalid $name: $value" >&2
      return 2
      ;;
  esac
}

AGENT_TURN_TIMEOUT_SECONDS="$(
  docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS 300
)"
OPENAI_PROVIDER_TIMEOUT_SECONDS="$(
  docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_OPENAI_PROVIDER_TIMEOUT_SECONDS "$AGENT_TURN_TIMEOUT_SECONDS"
)"
AGENT_TURNS_PARALLEL="$(read_boolean_env CARAPACE_INSTALL_E2E_AGENT_TURNS_PARALLEL 1)"
AGENT_TOOL_SMOKE="$(read_boolean_env CARAPACE_INSTALL_E2E_AGENT_TOOL_SMOKE 1)"
SESSION_SCAN_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_SESSION_SCAN_BYTES 16777216
)"
SESSION_LINE_BYTES="$(
  docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_SESSION_LINE_BYTES 1048576
)"
SESSION_SCAN_DEPTH="$(docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_SESSION_SCAN_DEPTH 64)"
SESSION_SCAN_NODES="$(docker_e2e_read_positive_int_env CARAPACE_INSTALL_E2E_SESSION_SCAN_NODES 100000)"

if [ ! -f "$PROFILE_FILE" ] && [ -f "$HOME/.profile" ]; then
  PROFILE_FILE="$HOME/.profile"
fi

PROFILE_STATUS="none"

read_profile_env_value() {
  local key="$1"
  (
    set +u
    # shellcheck disable=SC1090
    source "$PROFILE_FILE" >/dev/null
    printf '%s' "${!key:-}"
  )
}

for key in OPENAI_API_KEY ANTHROPIC_API_KEY ANTHROPIC_API_TOKEN; do
  if [ -f "$PROFILE_FILE" ] && [ -r "$PROFILE_FILE" ] && [ -z "${!key:-}" ]; then
    printf -v "$key" '%s' "$(read_profile_env_value "$key")"
    PROFILE_STATUS="$PROFILE_FILE"
  fi
  if [[ "${!key:-}" == "undefined" || "${!key:-}" == "null" ]]; then
    printf -v "$key" '%s' ""
  fi
  export "$key"
done

echo "==> Build image: $IMAGE_NAME"
docker_build_run install-e2e-build \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/docker/install-sh-e2e/Dockerfile" \
  "$ROOT_DIR/scripts/docker"

echo "==> Run E2E installer test"
echo "Profile file: $PROFILE_STATUS"
docker_e2e_docker_run_cmd run --rm \
  -e CARAPACE_INSTALL_URL="$INSTALL_URL" \
  -e CARAPACE_INSTALL_TAG="${CARAPACE_INSTALL_TAG:-latest}" \
  -e CARAPACE_E2E_MODELS="$CARAPACE_E2E_MODELS" \
  -e CARAPACE_INSTALL_E2E_OPENAI_MODEL="${CARAPACE_INSTALL_E2E_OPENAI_MODEL:-}" \
  -e CARAPACE_INSTALL_E2E_OPENAI_PROVIDER_TIMEOUT_SECONDS="$OPENAI_PROVIDER_TIMEOUT_SECONDS" \
  -e CARAPACE_INSTALL_E2E_PREVIOUS="${CARAPACE_INSTALL_E2E_PREVIOUS:-}" \
  -e CARAPACE_INSTALL_E2E_SKIP_PREVIOUS="${CARAPACE_INSTALL_E2E_SKIP_PREVIOUS:-0}" \
  -e CARAPACE_INSTALL_E2E_AGENT_TURN_TIMEOUT_SECONDS="$AGENT_TURN_TIMEOUT_SECONDS" \
  -e CARAPACE_INSTALL_E2E_AGENT_TURNS_PARALLEL="$AGENT_TURNS_PARALLEL" \
  -e CARAPACE_INSTALL_E2E_AGENT_TOOL_SMOKE="$AGENT_TOOL_SMOKE" \
  -e CARAPACE_INSTALL_E2E_SESSION_SCAN_BYTES="$SESSION_SCAN_BYTES" \
  -e CARAPACE_INSTALL_E2E_SESSION_LINE_BYTES="$SESSION_LINE_BYTES" \
  -e CARAPACE_INSTALL_E2E_SESSION_SCAN_DEPTH="$SESSION_SCAN_DEPTH" \
  -e CARAPACE_INSTALL_E2E_SESSION_SCAN_NODES="$SESSION_SCAN_NODES" \
  -e CARAPACE_NO_ONBOARD=1 \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e ANTHROPIC_API_TOKEN \
  "$IMAGE_NAME"
