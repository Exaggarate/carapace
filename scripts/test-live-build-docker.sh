#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${CARAPACE_LIVE_DOCKER_REPO_ROOT:-$SCRIPT_ROOT_DIR}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
source "$SCRIPT_ROOT_DIR/scripts/lib/docker-build.sh"
source "$SCRIPT_ROOT_DIR/scripts/lib/docker-e2e-container.sh"
DOCKER_COMMAND_TIMEOUT="${DOCKER_COMMAND_TIMEOUT:-${CARAPACE_LIVE_DOCKER_PULL_TIMEOUT:-600s}}"
IMAGE_NAME="${CARAPACE_IMAGE:-carapace:local}"
LIVE_IMAGE_NAME="${CARAPACE_LIVE_IMAGE:-${IMAGE_NAME}-live}"
DOCKER_BUILD_EXTENSIONS="${CARAPACE_DOCKER_BUILD_EXTENSIONS:-${CARAPACE_EXTENSIONS:-}}"
LIVE_IMAGE_PULL_ATTEMPTS="${CARAPACE_LIVE_DOCKER_PULL_ATTEMPTS:-3}"
LIVE_IMAGE_PULL_RETRY_DELAY_SECONDS="${CARAPACE_LIVE_DOCKER_PULL_RETRY_DELAY_SECONDS:-5}"

if ! [[ "$LIVE_IMAGE_PULL_ATTEMPTS" =~ ^[1-9][0-9]*$ ]]; then
  echo "CARAPACE_LIVE_DOCKER_PULL_ATTEMPTS must be a positive integer, got: $LIVE_IMAGE_PULL_ATTEMPTS" >&2
  exit 2
fi
if ! [[ "$LIVE_IMAGE_PULL_RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "CARAPACE_LIVE_DOCKER_PULL_RETRY_DELAY_SECONDS must be a non-negative integer, got: $LIVE_IMAGE_PULL_RETRY_DELAY_SECONDS" >&2
  exit 2
fi

DOCKER_BUILD_EXTENSIONS="$(node "$SCRIPT_ROOT_DIR/scripts/print-live-docker-plugin-selection.mjs" "$ROOT_DIR" "$DOCKER_BUILD_EXTENSIONS")"

DOCKER_BUILD_ARGS=()
if [[ -n "${DOCKER_BUILD_EXTENSIONS}" ]]; then
  DOCKER_BUILD_ARGS+=(--build-arg "CARAPACE_EXTENSIONS=${DOCKER_BUILD_EXTENSIONS}")
fi

pull_live_image() {
  local attempt
  for attempt in $(seq 1 "$LIVE_IMAGE_PULL_ATTEMPTS"); do
    echo "==> Pull live-test image attempt ${attempt}/${LIVE_IMAGE_PULL_ATTEMPTS}: $LIVE_IMAGE_NAME"
    if docker_e2e_docker_cmd pull "$LIVE_IMAGE_NAME"; then
      return 0
    fi
    if [[ "$attempt" -lt "$LIVE_IMAGE_PULL_ATTEMPTS" && "$LIVE_IMAGE_PULL_RETRY_DELAY_SECONDS" -gt 0 ]]; then
      sleep "$LIVE_IMAGE_PULL_RETRY_DELAY_SECONDS"
    fi
  done
  return 1
}

if [[ "${CARAPACE_SKIP_DOCKER_BUILD:-}" == "1" ]]; then
  echo "==> Reuse live-test image: $LIVE_IMAGE_NAME"
  if docker_e2e_docker_cmd image inspect "$LIVE_IMAGE_NAME" >/dev/null 2>&1; then
    exit 0
  fi
  if [[ "${CARAPACE_LIVE_REQUIRE_LOCAL_IMAGE:-0}" == "1" ]]; then
    echo "Required local live-test image not found: $LIVE_IMAGE_NAME" >&2
    exit 1
  fi
  echo "==> Live-test image not found locally; pulling: $LIVE_IMAGE_NAME"
  if pull_live_image; then
    exit 0
  fi
  if ! docker_build_on_missing_enabled; then
    echo "Live-test image not found: $LIVE_IMAGE_NAME" >&2
    echo "Build it first or unset CARAPACE_SKIP_DOCKER_BUILD." >&2
    exit 1
  fi
  echo "==> Live-test image not available; building because CARAPACE_DOCKER_BUILD_ON_MISSING/CARAPACE_TESTBOX allows fallback."
fi

echo "==> Build live-test image: $LIVE_IMAGE_NAME (target=build)"
echo "==> Bundled plugins: ${DOCKER_BUILD_EXTENSIONS}"
docker_build_run live-build "${DOCKER_BUILD_ARGS[@]}" --target build -t "$LIVE_IMAGE_NAME" -f "$ROOT_DIR/Dockerfile" "$ROOT_DIR"
