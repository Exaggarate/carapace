#!/usr/bin/env bash
# Installs the packed Carapace tarball over dirty old-user state. When
# CARAPACE_UPGRADE_SURVIVOR_BASELINE_SPEC is set, installs that published
# baseline first and upgrades it to the selected candidate.
set -euo pipefail

PACKAGE_TGZ=""
AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT=""
run_completed="0"
diagnostics_ready=0
cleanup_outer() {
  local exit_status="$?"
  trap - EXIT
  set +e
  # Bash 3.2 can enter EXIT with status 0 after a fatal nounset expansion.
  # Only a successfully joined scenario may turn cleanup into a successful exit.
  if [ "$exit_status" -eq 0 ] && [ "$run_completed" != "1" ]; then
    echo "Upgrade survivor exited before the scenario completed." >&2
    exit_status=1
  fi
  if [ "$exit_status" -ne 0 ]; then
    if [ "$diagnostics_ready" = "1" ]; then
      publish_diagnostics ||
        echo "Upgrade survivor diagnostics missing; preserving original lane failure." >&2
    else
      echo "Upgrade survivor diagnostics missing: no private capture prepared." >&2
    fi
  fi
  if [ -n "$PACKAGE_TGZ" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" ]; then
    rm -rf "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT"
  fi
  if [ "$exit_status" -ne 0 ]; then
    printf '[upgrade-survivor] FAILED (exit %s)\n' "$exit_status" >&2
  fi
  exit "$exit_status"
}
trap cleanup_outer EXIT

HARNESS_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_DIR="$(cd "${CARAPACE_DOCKER_E2E_REPO_ROOT:-$HARNESS_ROOT_DIR}" && pwd)"
DOCKER_E2E_HARNESS_ROOT_DIR="$HARNESS_ROOT_DIR"
source "$HARNESS_ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/upgrade-survivor-diagnostics.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/carapace-e2e-instance.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/frozen-target-compat.sh"
source "$HARNESS_ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

UPGRADE_ASSERTION_ARGS=()
UPGRADE_ASSERTIONS="$(carapace_resolve_frozen_target_file \
  "$ROOT_DIR" scripts/e2e/lib/upgrade-survivor/assertions.mjs)"
if [ -n "$UPGRADE_ASSERTIONS" ]; then
  # Upgrade survival is defined by the selected release's shipped state contract.
  UPGRADE_ASSERTION_ARGS+=(
    -v "$UPGRADE_ASSERTIONS:/app/scripts/e2e/lib/upgrade-survivor/assertions.mjs:ro"
  )
fi

IMAGE_NAME="$(docker_e2e_resolve_image "carapace-upgrade-survivor-e2e" CARAPACE_UPGRADE_SURVIVOR_E2E_IMAGE)"
SKIP_BUILD="${CARAPACE_UPGRADE_SURVIVOR_E2E_SKIP_BUILD:-0}"
DOCKER_RUN_TIMEOUT="${CARAPACE_UPGRADE_SURVIVOR_DOCKER_RUN_TIMEOUT:-1200s}"
BASELINE_SPEC="${CARAPACE_UPGRADE_SURVIVOR_BASELINE_SPEC:-}"
SCENARIO="${CARAPACE_UPGRADE_SURVIVOR_SCENARIO:-base}"
UPDATE_RESTART_MODE="${CARAPACE_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-manual}"
if [ "$SCENARIO" = "abandoned-update" ] && [ -z "${CARAPACE_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-}" ]; then
  UPDATE_RESTART_MODE="auto-auth"
fi
COMMAND_TIMEOUT="${CARAPACE_UPGRADE_SURVIVOR_COMMAND_TIMEOUT:-900s}"
START_BUDGET_SECONDS="$(carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_START_BUDGET_SECONDS 90)"
STATUS_BUDGET_SECONDS="$(carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS 30)"
PROBE_TIMEOUT_MS="$(carapace_e2e_read_nonnegative_int_env CARAPACE_UPGRADE_SURVIVOR_PROBE_TIMEOUT_MS 60000)"
PROBE_ATTEMPT_TIMEOUT_MS="$(
  carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_PROBE_ATTEMPT_TIMEOUT_MS 5000
)"
PROBE_MAX_BODY_BYTES="$(
  carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_PROBE_MAX_BODY_BYTES 1048576
)"
ROOT_MANAGED_VPS="${CARAPACE_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS:-0}"
LIVE_OPENAI="${CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI:-0}"
LIVE_OPENAI_ENV_ARGS=()
case "$LIVE_OPENAI" in
  0)
    ;;
  1)
    if [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
      echo "CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI=1 requires CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
      exit 2
    fi
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      echo "CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI=1 requires OPENAI_API_KEY" >&2
      exit 2
    fi
    LIVE_OPENAI_TIMEOUT_SECONDS="$(
      carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI_TIMEOUT_SECONDS 180
    )"
    LIVE_OPENAI_ENV_ARGS=(
      -e OPENAI_API_KEY
      -e CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI=1
      -e CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI_MODEL="${CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI_MODEL:-openai/gpt-5.5}"
      -e CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI_TIMEOUT_SECONDS="$LIVE_OPENAI_TIMEOUT_SECONDS"
    )
    ;;
  *)
    echo "CARAPACE_UPGRADE_SURVIVOR_LIVE_OPENAI must be 0 or 1; got: $LIVE_OPENAI" >&2
    exit 2
    ;;
esac

if { [ "$SCENARIO" = "sqlite-volume" ] || [ "$SCENARIO" = "recovery-cleanup" ] || [ "$SCENARIO" = "legacy-operator-state" ]; } && [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
  echo "$SCENARIO requires CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
  exit 1
fi
if [ "$SCENARIO" = "mobile-pairing-reconnect" ] && [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
  echo "mobile-pairing-reconnect requires CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
  exit 1
fi
if [ "$SCENARIO" = "recovery-cleanup" ] && { [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_OPENAI" != "0" ]; }; then
  echo "recovery-cleanup requires the isolated manual-restart fixture without live provider credentials" >&2
  exit 1
fi
if [ "$SCENARIO" = "mobile-pairing-reconnect" ] && { [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_OPENAI" != "0" ]; }; then
  echo "mobile-pairing-reconnect requires the isolated manual-restart fixture without live provider credentials" >&2
  exit 1
fi

if [ "$SCENARIO" = "abandoned-update" ] && {
  [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ] ||
  [ "$UPDATE_RESTART_MODE" != "auto-auth" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_OPENAI" != "0" ];
}; then
  echo "abandoned-update requires the published baseline, auto-auth service fixture, and no live provider" >&2
  exit 1
fi

resolve_lane_artifact_suffix() {
  if [ -n "${CARAPACE_DOCKER_ALL_LANE_NAME:-}" ]; then
    printf "%s" "$CARAPACE_DOCKER_ALL_LANE_NAME"
    return
  fi

  if [ "$ROOT_MANAGED_VPS" = "1" ]; then
    printf "root-managed-vps-upgrade"
  elif [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
    printf "update-restart-auth"
  elif [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" = "1" ]; then
    printf "published-upgrade-survivor"
  else
    printf "upgrade-survivor"
  fi

  if [ -n "${BASELINE_SPEC// }" ]; then
    printf -- "-%s" "$BASELINE_SPEC"
  fi
  if [ "$SCENARIO" != "base" ]; then
    printf -- "-%s" "$SCENARIO"
  fi
}

LANE_ARTIFACT_SUFFIX="$(resolve_lane_artifact_suffix)"
LANE_ARTIFACT_SUFFIX="${LANE_ARTIFACT_SUFFIX//[^A-Za-z0-9_.-]/_}"
ARTIFACT_DIR="${CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/upgrade-survivor/$LANE_ARTIFACT_SUFFIX}"
DOCKER_RUN_USER_ARGS=()
PROBE_ENV_ARGS=(
  -e CARAPACE_UPGRADE_SURVIVOR_PROBE_TIMEOUT_MS="$PROBE_TIMEOUT_MS"
  -e CARAPACE_UPGRADE_SURVIVOR_PROBE_ATTEMPT_TIMEOUT_MS="$PROBE_ATTEMPT_TIMEOUT_MS"
  -e CARAPACE_UPGRADE_SURVIVOR_PROBE_MAX_BODY_BYTES="$PROBE_MAX_BODY_BYTES"
)
if [ -n "${CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING:-}" ]; then
  PROBE_ENV_ARGS+=(
    -e CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING="$CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING"
  )
fi
if [ -n "${CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED:-}" ]; then
  PROBE_ENV_ARGS+=(
    -e CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED="$CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED"
  )
fi
if [ "$ROOT_MANAGED_VPS" = "1" ]; then
  if [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
    echo "CARAPACE_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS=1 requires CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
    exit 1
  fi
  DOCKER_RUN_USER_ARGS+=(--user root -e HOME=/root -e USER=root)
fi

normalize_npm_candidate() {
  local raw="$1"
  case "$raw" in
    latest | beta)
      printf 'carapace@%s\n' "$raw"
      ;;
    carapace@*)
      printf '%s\n' "$raw"
      ;;
    *@*)
      echo "CARAPACE_UPGRADE_SURVIVOR_CANDIDATE must be current, latest, beta, carapace@<version>, a bare version, or a .tgz path." >&2
      return 1
      ;;
    *)
      printf 'carapace@%s\n' "$raw"
      ;;
  esac
}

if [ "${CARAPACE_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" = "1" ]; then
  if [ -z "${BASELINE_SPEC// }" ]; then
    echo "CARAPACE_UPGRADE_SURVIVOR_BASELINE_SPEC is required for published upgrade survivor" >&2
    exit 1
  fi

  mkdir -p "$ARTIFACT_DIR"
  chmod -R a+rwX "$ARTIFACT_DIR" || true
  prepare_diagnostics_capture

  DOCKER_E2E_PACKAGE_ARGS=()
  CANDIDATE_RAW="${CARAPACE_UPGRADE_SURVIVOR_CANDIDATE:-current}"
  CANDIDATE_KIND="npm"
  CANDIDATE_IS_CURRENT=0
  CANDIDATE_SPEC=""

  if [ -n "${CARAPACE_CURRENT_PACKAGE_TGZ:-}" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor "$CARAPACE_CURRENT_PACKAGE_TGZ")"
    CANDIDATE_KIND="tarball"
    CANDIDATE_IS_CURRENT=1
    CANDIDATE_SPEC="/tmp/carapace-current.tgz"
  elif [ "$CANDIDATE_RAW" = "current" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor)"
    CANDIDATE_KIND="tarball"
    CANDIDATE_IS_CURRENT=1
    CANDIDATE_SPEC="/tmp/carapace-current.tgz"
  elif [[ "$CANDIDATE_RAW" == *.tgz ]]; then
    if [ ! -f "$CANDIDATE_RAW" ]; then
      echo "Carapace candidate tarball does not exist: $CANDIDATE_RAW" >&2
      exit 1
    fi
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor "$CANDIDATE_RAW")"
    CANDIDATE_KIND="tarball"
    CANDIDATE_SPEC="/tmp/carapace-current.tgz"
  else
    CANDIDATE_KIND="npm"
    CANDIDATE_SPEC="$(normalize_npm_candidate "$CANDIDATE_RAW")"
  fi

  if [ "$CANDIDATE_IS_CURRENT" = "1" ] && [ -z "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
      mktemp -d "${TMPDIR:-/tmp}/carapace-upgrade-survivor-plugin-registry.XXXXXX"
    )"
    CARAPACE_DOCKER_ALL_LANES=published-upgrade-survivor \
      CARAPACE_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
      CARAPACE_DOCKER_ALL_TIMINGS=0 \
      CARAPACE_UPGRADE_SURVIVOR_BASELINE_SPECS="$BASELINE_SPEC" \
      CARAPACE_UPGRADE_SURVIVOR_SCENARIOS="$SCENARIO" \
      node "$HARNESS_ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry
    export CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
  fi

  if [ -n "$PACKAGE_TGZ" ]; then
    docker_e2e_package_mount_args "$PACKAGE_TGZ"
  elif [ -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    carapace_prepublish_plugin_registry_configure_docker_args "$CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR"
    DOCKER_E2E_PACKAGE_ARGS=("${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}")
  fi

  CARAPACE_TEST_STATE_FUNCTION_B64="$(docker_e2e_test_state_function_b64)"

  docker_e2e_build_or_reuse "$IMAGE_NAME" upgrade-survivor "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "bare" "$SKIP_BUILD"

  echo "Running published upgrade survivor Docker E2E..."
  # Keep candidate images from selecting an older copy of the trusted release runner.
  docker_e2e_run_with_harness \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e CARAPACE_TEST_STATE_FUNCTION_B64="$CARAPACE_TEST_STATE_FUNCTION_B64" \
    -e CARAPACE_UPGRADE_SURVIVOR_BASELINE="$BASELINE_SPEC" \
    -e CARAPACE_UPGRADE_SURVIVOR_CANDIDATE_KIND="$CANDIDATE_KIND" \
    -e CARAPACE_UPGRADE_SURVIVOR_CANDIDATE_SPEC="$CANDIDATE_SPEC" \
    -e CARAPACE_DOCKER_E2E_SELECTED_SHA="${CARAPACE_DOCKER_E2E_SELECTED_SHA:-}" \
    -e CARAPACE_UPGRADE_SURVIVOR_SCENARIO="$SCENARIO" \
    -e CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT="${CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT:-/tmp/carapace-upgrade-survivor-runtime}" \
    -e CARAPACE_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE="$UPDATE_RESTART_MODE" \
    -e CARAPACE_UPGRADE_SURVIVOR_COMMAND_TIMEOUT="$COMMAND_TIMEOUT" \
    -e CARAPACE_UPGRADE_SURVIVOR_VOLUME_SESSIONS="${CARAPACE_UPGRADE_SURVIVOR_VOLUME_SESSIONS:-}" \
    -e CARAPACE_UPGRADE_SURVIVOR_VOLUME_EVENTS_PER_SESSION="${CARAPACE_UPGRADE_SURVIVOR_VOLUME_EVENTS_PER_SESSION:-}" \
    -e CARAPACE_UPGRADE_SURVIVOR_VOLUME_CRON_JOBS="${CARAPACE_UPGRADE_SURVIVOR_VOLUME_CRON_JOBS:-}" \
    -e CARAPACE_UPGRADE_SURVIVOR_VOLUME_IDEMPOTENCE_BUDGET_SECONDS="${CARAPACE_UPGRADE_SURVIVOR_VOLUME_IDEMPOTENCE_BUDGET_SECONDS:-60}" \
    -e CARAPACE_UPGRADE_SURVIVOR_LEGACY_RUNTIME_DEPS_SYMLINK="${CARAPACE_UPGRADE_SURVIVOR_LEGACY_RUNTIME_DEPS_SYMLINK:-}" \
    -e CARAPACE_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS="$ROOT_MANAGED_VPS" \
    -e CARAPACE_UPGRADE_SURVIVOR_SUMMARY_JSON=/tmp/carapace-upgrade-survivor-artifacts/summary.json \
    -e CARAPACE_UPGRADE_SURVIVOR_START_BUDGET_SECONDS="$START_BUDGET_SECONDS" \
    -e CARAPACE_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS="$STATUS_BUDGET_SECONDS" \
    -e CARAPACE_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER=/tmp/carapace-clawhub-fixture-server.cjs \
    -e CARAPACE_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER=/tmp/carapace-config-parking.mjs \
    "${PROBE_ENV_ARGS[@]}" \
    ${LIVE_OPENAI_ENV_ARGS[@]+"${LIVE_OPENAI_ENV_ARGS[@]}"} \
    -v "$ARTIFACT_DIR:/tmp/carapace-upgrade-survivor-artifacts" \
    -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/clawhub-fixture-server.cjs:/tmp/carapace-clawhub-fixture-server.cjs:ro" \
    -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/config-parking.mjs:/tmp/carapace-config-parking.mjs:ro" \
    -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/run.sh:/tmp/carapace-upgrade-survivor-run.sh:ro" \
    ${UPGRADE_ASSERTION_ARGS[@]+"${UPGRADE_ASSERTION_ARGS[@]}"} \
    ${DOCKER_E2E_PACKAGE_ARGS[@]+"${DOCKER_E2E_PACKAGE_ARGS[@]}"} \
    ${DOCKER_RUN_USER_ARGS[@]+"${DOCKER_RUN_USER_ARGS[@]}"} \
    "$IMAGE_NAME" \
    timeout --kill-after=30s "$DOCKER_RUN_TIMEOUT" bash /tmp/carapace-upgrade-survivor-run.sh
  run_completed="1"
  exit 0
fi

PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor "${CARAPACE_CURRENT_PACKAGE_TGZ:-}")"
if [ -z "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
    mktemp -d "${TMPDIR:-/tmp}/carapace-upgrade-survivor-plugin-registry.XXXXXX"
  )"
  planner_lane="upgrade-survivor"
  if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
    planner_lane="update-restart-auth"
  fi
  CARAPACE_DOCKER_ALL_LANES="$planner_lane" \
    CARAPACE_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
    CARAPACE_DOCKER_ALL_TIMINGS=0 \
    CARAPACE_UPGRADE_SURVIVOR_SCENARIOS="$SCENARIO" \
    node "$HARNESS_ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry
  export CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
fi
docker_e2e_package_mount_args "$PACKAGE_TGZ"
CARAPACE_TEST_STATE_FUNCTION_B64="$(docker_e2e_test_state_function_b64)"
mkdir -p "$ARTIFACT_DIR"
chmod -R a+rwX "$ARTIFACT_DIR" || true
prepare_diagnostics_capture

docker_e2e_build_or_reuse "$IMAGE_NAME" upgrade-survivor "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "bare" "$SKIP_BUILD"

echo "Running upgrade survivor Docker E2E..."
docker_e2e_run_with_harness \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e CARAPACE_TEST_STATE_FUNCTION_B64="$CARAPACE_TEST_STATE_FUNCTION_B64" \
  -e CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT=/tmp/carapace-upgrade-survivor-artifacts \
  -e CARAPACE_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS="$ROOT_MANAGED_VPS" \
  -e CARAPACE_UPGRADE_SURVIVOR_SCENARIO="$SCENARIO" \
  -e CARAPACE_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE="$UPDATE_RESTART_MODE" \
  -e CARAPACE_UPGRADE_SURVIVOR_COMMAND_TIMEOUT="$COMMAND_TIMEOUT" \
  -e CARAPACE_UPGRADE_SURVIVOR_START_BUDGET_SECONDS="$START_BUDGET_SECONDS" \
  -e CARAPACE_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS="$STATUS_BUDGET_SECONDS" \
  -e CARAPACE_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER=/tmp/carapace-clawhub-fixture-server.cjs \
  -e CARAPACE_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER=/tmp/carapace-config-parking.mjs \
  "${PROBE_ENV_ARGS[@]}" \
  -v "$ARTIFACT_DIR:/tmp/carapace-upgrade-survivor-artifacts" \
  -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/clawhub-fixture-server.cjs:/tmp/carapace-clawhub-fixture-server.cjs:ro" \
  -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/config-parking.mjs:/tmp/carapace-config-parking.mjs:ro" \
  ${UPGRADE_ASSERTION_ARGS[@]+"${UPGRADE_ASSERTION_ARGS[@]}"} \
  ${DOCKER_E2E_PACKAGE_ARGS[@]+"${DOCKER_E2E_PACKAGE_ARGS[@]}"} \
  ${DOCKER_RUN_USER_ARGS[@]+"${DOCKER_RUN_USER_ARGS[@]}"} \
  "$IMAGE_NAME" \
 timeout --kill-after=30s "$DOCKER_RUN_TIMEOUT" bash -lc 'set -euo pipefail
 source scripts/lib/carapace-e2e-instance.sh
 source scripts/e2e/lib/prepublish-plugin-registry.sh

export npm_config_loglevel=error
export npm_config_fund=false
export npm_config_audit=false
export CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT="${CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT:-/tmp/carapace-upgrade-survivor-artifacts}"
export CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT="${CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT:-/tmp/carapace-upgrade-survivor-runtime}"
mkdir -p "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT"
export TMPDIR="${CARAPACE_UPGRADE_SURVIVOR_TMPDIR:-$CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT/tmp}"
export CARAPACE_TEST_STATE_TMPDIR="${CARAPACE_UPGRADE_SURVIVOR_TEST_STATE_TMPDIR:-$CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT/state-tmp}"
export npm_config_prefix="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/npm-prefix"
export NPM_CONFIG_PREFIX="$npm_config_prefix"
export npm_config_cache="${CARAPACE_UPGRADE_SURVIVOR_NPM_CACHE:-$CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT/npm-cache}"
export NPM_CONFIG_CACHE="$npm_config_cache"
export npm_config_tmp="$TMPDIR"
mkdir -p "$CARAPACE_UPGRADE_SURVIVOR_RUNTIME_ROOT" "$TMPDIR" "$CARAPACE_TEST_STATE_TMPDIR" "$npm_config_prefix" "$npm_config_cache"
chmod 700 "$npm_config_cache" || true
export PATH="$npm_config_prefix/bin:$PATH"
export CI=true
export CARAPACE_NO_ONBOARD=1
export CARAPACE_NO_PROMPT=1
export CARAPACE_SKIP_PROVIDERS=1
export CARAPACE_SKIP_CHANNELS=1
export CARAPACE_DISABLE_BONJOUR=1
export GATEWAY_AUTH_TOKEN_REF="upgrade-survivor-token"
export OPENAI_API_KEY="sk-carapace-upgrade-survivor"
export DISCORD_BOT_TOKEN="upgrade-survivor-discord-token"
export TELEGRAM_BOT_TOKEN="123456:upgrade-survivor-telegram-token"
SCENARIO="${CARAPACE_UPGRADE_SURVIVOR_SCENARIO:-base}"
if [ "$SCENARIO" = "feishu-channel" ]; then
  export FEISHU_APP_SECRET="upgrade-survivor-feishu-secret"
fi
if [ "$SCENARIO" = "configured-plugin-installs" ] || [ "$SCENARIO" = "sqlite-volume" ]; then
  export BRAVE_API_KEY="BSA_upgrade_survivor_brave_key"
fi

UPDATE_RESTART_MODE="${CARAPACE_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-manual}"
command_timeout="${CARAPACE_UPGRADE_SURVIVOR_COMMAND_TIMEOUT:-900s}"
PORT=18789
START_BUDGET="$(carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_START_BUDGET_SECONDS 90)"
STATUS_BUDGET="$(carapace_e2e_read_positive_int_env CARAPACE_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS 30)"
GATEWAY_LOG="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/gateway.log"
SYSTEMCTL_SHIM_LOG="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim.log"
SYSTEMCTL_SHIM_PID_FILE="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim.pid"
SYSTEMCTL_SHIM_DAEMON_LOG="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim-gateway.log"
BASELINE_SERVICE_INSTALL_JSON="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/baseline-service-install.json"
BASELINE_SERVICE_INSTALL_ERR="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/baseline-service-install.err"
export CARAPACE_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_LOG="$SYSTEMCTL_SHIM_LOG"
export CARAPACE_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_PID_FILE="$SYSTEMCTL_SHIM_PID_FILE"
export CARAPACE_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_DAEMON_LOG="$SYSTEMCTL_SHIM_DAEMON_LOG"
export CARAPACE_UPGRADE_SURVIVOR_BASELINE_SERVICE_INSTALL_JSON="$BASELINE_SERVICE_INSTALL_JSON"
export CARAPACE_UPGRADE_SURVIVOR_BASELINE_SERVICE_INSTALL_ERR="$BASELINE_SERVICE_INSTALL_ERR"

gateway_pid=""
plugin_registry_pid=""
clawhub_fixture_pid=""
run_completed="0"
cleanup() {
  if [ -s "$SYSTEMCTL_SHIM_PID_FILE" ]; then
    systemctl --user stop carapace-gateway.service >/dev/null 2>&1 || true
  fi
  carapace_e2e_terminate_gateways "${gateway_pid:-}"
  if [ -s "$SYSTEMCTL_SHIM_PID_FILE" ]; then
    carapace_e2e_terminate_gateways "$(cat "$SYSTEMCTL_SHIM_PID_FILE" 2>/dev/null || true)"
  fi
  carapace_e2e_stop_process "${plugin_registry_pid:-}"
  carapace_e2e_stop_process "${clawhub_fixture_pid:-}"
}
CURRENT_PHASE="setup"
on_exit() {
  local result="$1"
  trap - EXIT
  set +e
  if [ "$result" -eq 0 ] && [ "$run_completed" != "1" ]; then
    echo "Upgrade survivor exited before all assertions completed." >&2
    result=1
  fi
  if [ "$result" -ne 0 ]; then
    node scripts/e2e/lib/upgrade-survivor/diagnostics.mjs capture \
      "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT" "$CURRENT_PHASE" "$result" ||
      echo "Upgrade survivor diagnostics missing; preserving original phase failure." >&2
  fi
  cleanup
  exit "$result"
}
trap '"'"'on_exit $?'"'"' EXIT

wait_for_fixture_port() {
  local pid="$1" port_file="$2" log_file="$3" label="$4"
  for _ in $(seq 1 100); do
    [ -s "$port_file" ] && return 0
    carapace_e2e_process_alive "$pid" || break
    sleep 0.1
  done
  carapace_e2e_print_log "$log_file" >&2
  echo "Timed out waiting for upgrade survivor $label." >&2
  return 1
}

configure_clawhub_fixture() {
  unset CARAPACE_CLAWHUB_URL CLAWHUB_URL
  [ -z "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] && return 0
  local fixture_root="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/clawhub-fixture" port_file log_file
  port_file="$fixture_root/port"
  log_file="$fixture_root/server.log"
  mkdir -p "$fixture_root"
  node "$CARAPACE_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER" \
    prepublish-artifacts "$port_file" \
    "$CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR/prepublish-plugin-registry.json" >"$log_file" 2>&1 &
  clawhub_fixture_pid="$!"
  wait_for_fixture_port "$clawhub_fixture_pid" "$port_file" "$log_file" "ClawHub fixture"
  export CARAPACE_CLAWHUB_URL="http://127.0.0.1:$(cat "$port_file")"
}

 configure_plugin_registry() {
   local fixture_root="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/plugin-registry"
   local package_dir="$fixture_root/package"
   local tarball="$fixture_root/carapace-brave-plugin-2026.5.2.tgz"
   local registry_args=()

   if [ "${CARAPACE_UPGRADE_SURVIVOR_SCENARIO:-base}" = "configured-plugin-installs" ]; then
    mkdir -p "$package_dir"
    FIXTURE_PACKAGE_DIR="$package_dir" node <<'"'"'NODE'"'"'
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.FIXTURE_PACKAGE_DIR;
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(
  path.join(root, "package.json"),
  `${JSON.stringify(
    {
      name: "@carapace/brave-plugin",
      version: "2026.5.2",
      carapace: { extensions: ["./index.js"] },
    },
    null,
    2,
  )}\n`,
);
fs.writeFileSync(
  path.join(root, "carapace.plugin.json"),
  `${JSON.stringify(
    {
      id: "brave",
      activation: { onStartup: false },
      setup: { providers: [{ id: "brave", envVars: ["BRAVE_API_KEY"] }] },
      contracts: { webSearchProviders: ["brave"] },
      configSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          webSearch: {
            type: "object",
            additionalProperties: false,
            properties: {
              apiKey: { type: ["string", "object"] },
              mode: { type: "string", enum: ["web", "llm-context"] },
              baseUrl: { type: ["string", "object"] },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`,
);
fs.writeFileSync(
  path.join(root, "index.js"),
  `module.exports = { id: "brave", name: "Brave Fixture", register() {} };\n`,
);
NODE
    tar -czf "$tarball" -C "$fixture_root" package
    registry_args+=("@carapace/brave-plugin" "2026.5.2" "$tarball")
  fi

   if [ "${#registry_args[@]}" -eq 0 ]; then
     [ -n "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] || return 0
   fi

 carapace_prepublish_plugin_registry_start \
     "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" \
     "${CARAPACE_DOCKER_E2E_SELECTED_SHA:-}" \
     "$package_version" \
     "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_MANIFEST_SHA256:-}" \
     "$fixture_root" \
     plugin_registry_pid \
     ${registry_args[@]+"${registry_args[@]}"}
 }

install_companion_plugins() {
  local authored_config="$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/companion-install-authored.json"
  local install_status=0
  local restore_status=0
  node "$CARAPACE_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER" \
    park-companion-install "$CARAPACE_CONFIG_PATH" "$authored_config"

  set +e
  carapace_e2e_fixture_plugin_command carapace -- \
    plugins install "npm:@carapace/discord@$package_version" --pin
  install_status=$?
  if [ "$install_status" -eq 0 ]; then
    carapace_e2e_fixture_plugin_command carapace -- \
      plugins install "clawhub:@carapace/whatsapp@$package_version"
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    node "$CARAPACE_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER" \
      assert-prepublish-requests "$CARAPACE_CLAWHUB_URL" "@carapace/whatsapp" "$package_version"
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    carapace_e2e_fixture_plugin_command carapace -- \
      plugins install "npm:@carapace/codex@$package_version" --pin
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    # Inspection validates config too; keep the legacy migration specimen parked
    # until companion installation and its provenance checks have both finished.
    node scripts/e2e/lib/upgrade-survivor/assertions.mjs \
      assert-companion-installs "$package_version" \
      "${CARAPACE_E2E_LAST_FIXTURE_PLUGIN_CAPABILITY_CONSENT_SUPPORTED:?missing candidate capability-consent support}"
    install_status=$?
  fi
  node "$CARAPACE_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER" \
    restore "$CARAPACE_CONFIG_PATH" "$authored_config"
  restore_status=$?
  set -e

  if [ "$install_status" -ne 0 ]; then
    return "$install_status"
  fi
  if [ "$restore_status" -ne 0 ]; then
    return "$restore_status"
  fi
}

carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_FUNCTION_B64:?missing CARAPACE_TEST_STATE_FUNCTION_B64}"
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  account_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  if [ -z "$account_home" ]; then
    echo "Could not resolve the current account home" >&2
    exit 1
  fi
  carapace_test_state_create "$account_home" upgrade-survivor
  export HOME="$account_home"
  export USERPROFILE="$account_home"
  export CARAPACE_STATE_DIR="$account_home/.carapace"
  export CARAPACE_CONFIG_PATH="$CARAPACE_STATE_DIR/carapace.json"
  unset CARAPACE_HOME
else
  carapace_test_state_create upgrade-survivor upgrade-survivor
fi
node scripts/e2e/lib/upgrade-survivor/assertions.mjs seed

CURRENT_PHASE="install-candidate"
carapace_e2e_install_package "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/install.log" "upgrade survivor package" "$npm_config_prefix"
command -v carapace >/dev/null
package_version="$(node -p "JSON.parse(require(\"node:fs\").readFileSync(process.argv[1] + \"/lib/node_modules/carapace/package.json\", \"utf8\")).version" "$npm_config_prefix")"
CARAPACE_PACKAGE_ACCEPTANCE_LEGACY_COMPAT="$(
  node scripts/e2e/lib/package-compat.mjs "$package_version"
)"
export CARAPACE_PACKAGE_ACCEPTANCE_LEGACY_COMPAT

echo "Checking dirty-state config before update..."
CURRENT_PHASE="prepare-state"
CARAPACE_UPGRADE_SURVIVOR_ASSERT_STAGE=baseline node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-config
CARAPACE_UPGRADE_SURVIVOR_ASSERT_STAGE=baseline node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-state
configure_clawhub_fixture
configure_plugin_registry
install_companion_plugins
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  # shellcheck disable=SC1091
  source scripts/e2e/lib/upgrade-survivor/update-restart-auth.sh
  prepare_update_restart_probe_current_install "$PORT" "$GATEWAY_LOG"
  pre_update_service_pid="$(cat "$SYSTEMCTL_SHIM_PID_FILE")"
  pre_update_systemctl_lines="$(wc -l <"$SYSTEMCTL_SHIM_LOG")"
fi

echo "Running package update against the mounted tarball..."
CURRENT_PHASE="update-candidate"
update_args=(update --tag "${CARAPACE_CURRENT_PACKAGE_TGZ:?missing CARAPACE_CURRENT_PACKAGE_TGZ}" --yes --json)
if [ "$UPDATE_RESTART_MODE" != "auto-auth" ]; then
  update_args+=(--no-restart)
fi
set +e
carapace_e2e_maybe_timeout "$command_timeout" env -u CARAPACE_GATEWAY_TOKEN -u CARAPACE_GATEWAY_PASSWORD CARAPACE_ALLOW_ROOT=1 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$PWD/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs" carapace "${update_args[@]}" >"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.json" 2>"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.err"
update_status=$?
set -e
if [ "$update_status" -ne 0 ]; then
  echo "carapace update failed" >&2
  validate_status=0
  carapace_e2e_maybe_timeout "$command_timeout" carapace config validate --json >"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.json" 2>"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.err" || validate_status=$?
  echo "post-update config validation probe status=$validate_status" >&2
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.err" >&2 || true
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.json" >&2 || true
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.err" >&2 || true
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.json" >&2 || true
  exit "$update_status"
fi
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  echo "Skipping doctor repair until after restart proof."
else
  echo "Running non-interactive doctor repair..."
  CURRENT_PHASE="doctor"
  if ! carapace_e2e_maybe_timeout "$command_timeout" carapace doctor --fix --non-interactive >"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" 2>&1; then
    echo "carapace doctor failed" >&2
    carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" >&2
    exit 1
  fi
  if ! carapace_e2e_maybe_timeout "$command_timeout" carapace config validate >>"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" 2>&1; then
    echo "post-doctor config validation failed" >&2
    carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" >&2
    exit 1
  fi
fi

echo "Verifying config and state survived update..."
CURRENT_PHASE="assert-state"
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-config
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-state

startup_summary="n/a"
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  assert_update_restart_service_replaced "$pre_update_service_pid" "$pre_update_systemctl_lines"
  echo "Gateway restart was handled by carapace update."
else
  echo "Starting gateway from upgraded state..."
  CURRENT_PHASE="start-gateway"
  start_epoch="$(node -e "process.stdout.write(String(Date.now()))")"
  carapace gateway --port "$PORT" --bind loopback --allow-unconfigured >"$GATEWAY_LOG" 2>&1 &
  gateway_pid="$!"
  carapace_e2e_wait_gateway_ready "$gateway_pid" "$GATEWAY_LOG" 360 "$PORT"
  ready_epoch="$(node -e "process.stdout.write(String(Date.now()))")"
  start_seconds=$(((ready_epoch - start_epoch + 999) / 1000))
  if [ "$start_seconds" -gt "$START_BUDGET" ]; then
    echo "gateway startup exceeded survivor budget: ${start_seconds}s > ${START_BUDGET}s" >&2
    carapace_e2e_print_log "$GATEWAY_LOG" >&2
    exit 1
  fi
  startup_summary="${start_seconds}s"
fi

echo "Checking gateway HTTP probes..."
CURRENT_PHASE="http-probes"
node scripts/e2e/lib/upgrade-survivor/probe-gateway.mjs \
  --base-url "http://127.0.0.1:$PORT" \
  --path /healthz \
  --expect live \
  --out "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/healthz.json"

readyz_probe_args=(
  --base-url "http://127.0.0.1:$PORT"
  --path /readyz
  --expect ready
)
if [ -n "${CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING:-}" ]; then
  readyz_probe_args+=(--allow-failing "$CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING")
fi
if [ "${CARAPACE_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED:-}" = "1" ]; then
  readyz_probe_args+=(--allow-degraded-ready)
fi
readyz_probe_args+=(--out "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/readyz.json")
node scripts/e2e/lib/upgrade-survivor/probe-gateway.mjs "${readyz_probe_args[@]}"

echo "Checking gateway RPC status..."
CURRENT_PHASE="status"
status_start="$(node -e "process.stdout.write(String(Date.now()))")"
if ! carapace_e2e_maybe_timeout "$command_timeout" carapace gateway status --url "ws://127.0.0.1:$PORT" --token "$GATEWAY_AUTH_TOKEN_REF" --require-rpc --timeout 30000 --json >"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json" 2>"$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.err"; then
  echo "gateway status failed" >&2
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.err" >&2
  carapace_e2e_print_log "$GATEWAY_LOG" >&2
  carapace_e2e_print_log "$SYSTEMCTL_SHIM_DAEMON_LOG" >&2
  exit 1
fi
status_end="$(node -e "process.stdout.write(String(Date.now()))")"
status_seconds=$(((status_end - status_start + 999) / 1000))
if [ "$status_seconds" -gt "$STATUS_BUDGET" ]; then
  echo "gateway status exceeded survivor budget: ${status_seconds}s > ${STATUS_BUDGET}s" >&2
  carapace_e2e_print_log "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json" >&2
  exit 1
fi
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-status-json "$CARAPACE_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json"

echo "Upgrade survivor Docker E2E passed scenario=${CARAPACE_UPGRADE_SURVIVOR_SCENARIO:-base} updateRestartMode=${UPDATE_RESTART_MODE} startup=${startup_summary} status=${status_seconds}s."
run_completed="1"
'
run_completed="1"
