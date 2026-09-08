#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$ROOT_DIR/scripts/lib/carapace-e2e-instance.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

read_positive_int_env() {
  local name="${1:?missing environment variable name}"
  local fallback="${2:?missing fallback value}"
  local value="${!name-}"
  if [ -z "${!name+x}" ]; then
    value="$fallback"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( 10#$value < 1 )); then
    echo "invalid $name: $value" >&2
    return 2
  fi
  printf "%s\n" "$((10#$value))"
}

BUN_BIN="${BUN_BIN:-bun}"
HOST_BUILD="${CARAPACE_BUN_GLOBAL_SMOKE_HOST_BUILD:-1}"
DIST_IMAGE="${CARAPACE_BUN_GLOBAL_SMOKE_DIST_IMAGE:-}"
PACKAGE_TGZ="${CARAPACE_BUN_GLOBAL_SMOKE_PACKAGE_TGZ:-}"
COMMAND_TIMEOUT_MS="$(read_positive_int_env CARAPACE_BUN_GLOBAL_SMOKE_TIMEOUT_MS 180000)"
DOCKER_COMMAND_TIMEOUT="${DOCKER_COMMAND_TIMEOUT:-${CARAPACE_BUN_GLOBAL_SMOKE_DOCKER_COMMAND_TIMEOUT:-600s}}"
AI_PACKAGE_TGZ=""
REGISTRY_PID=""
REQUIRED_REGISTRY_PACKAGES='[]'
SMOKE_DIR=""
PACK_DIR=""
MOCK_PID=""
GATEWAY_PID=""
INSTALL_LOG=""
UNTRUSTED_LOG=""
CLI_STATUS_LOG=""
CLI_PLUGINS_LOG=""
MOCK_LOG=""
MOCK_REQUEST_LOG=""
LOCAL_AGENT_LOG=""
GATEWAY_LOG=""
GATEWAY_HEALTH_LOG=""
GATEWAY_AGENT_LOG=""

cleanup() {
  carapace_e2e_stop_process "${GATEWAY_PID:-}"
  carapace_e2e_stop_process "${MOCK_PID:-}"
  carapace_e2e_stop_process "${REGISTRY_PID:-}"
  if [ -n "${SMOKE_DIR:-}" ]; then
    rm -rf "$SMOKE_DIR"
  fi
  if [ -n "${PACK_DIR:-}" ]; then
    rm -rf "$PACK_DIR"
  fi
}

dump_debug_logs() {
  local status="$1"
  echo "bun global install smoke failed with exit code $status" >&2
  carapace_e2e_dump_logs \
    "$INSTALL_LOG" \
    "$UNTRUSTED_LOG" \
    "$CLI_STATUS_LOG" \
    "$CLI_PLUGINS_LOG" \
    "$MOCK_LOG" \
    "$MOCK_REQUEST_LOG" \
    "$LOCAL_AGENT_LOG" \
    "$GATEWAY_LOG" \
    "$GATEWAY_HEALTH_LOG" \
    "$GATEWAY_AGENT_LOG" >&2 || true
}

prepare_ai_candidate() {
  local ai_manifest
  local ai_package_dir
  local ai_tarballs
  local root_manifest

  if [ -z "$PACK_DIR" ]; then
    PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/carapace-bun-pack.XXXXXX")"
  fi
  root_manifest="$PACK_DIR/carapace-package.json"
  tar -xOf "$PACKAGE_TGZ" package/package.json >"$root_manifest"
  if ! tar -tzf "$PACKAGE_TGZ" package/node_modules/@carapace/ai/package.json >/dev/null 2>&1; then
    if node -e '
const manifest = require(process.argv[1]);
process.exit(manifest.dependencies?.["@carapace/ai"] ? 0 : 1);
' "$root_manifest"; then
      if [ -z "${CARAPACE_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
        echo "Carapace tarball requires a verified candidate registry for unbundled @carapace/ai" >&2
        exit 1
      fi
      REQUIRED_REGISTRY_PACKAGES='["@carapace/ai"]'
      echo "==> Resolve candidate @carapace/ai from the prepared package registry"
      return
    fi
    echo "==> Candidate has no bundled @carapace/ai dependency"
    return
  fi
  echo "==> Extract bundled candidate @carapace/ai package"
  ai_package_dir="$PACK_DIR/ai-candidate"
  mkdir -p "$ai_package_dir"
  tar -xzf "$PACKAGE_TGZ" \
    -C "$ai_package_dir" \
    --strip-components=4 \
    package/node_modules/@carapace/ai
  ai_manifest="$ai_package_dir/package.json"
  node scripts/e2e/lib/bun-global-install/assertions.mjs \
    assert-release-versions \
    "$root_manifest" \
    "$ai_manifest" \
    >/dev/null
  npm pack --ignore-scripts --silent --pack-destination "$PACK_DIR" "$ai_package_dir" >/dev/null
  ai_tarballs=("$PACK_DIR"/carapace-ai-*.tgz)
  if [ "${#ai_tarballs[@]}" -ne 1 ] || [ ! -f "${ai_tarballs[0]}" ]; then
    echo "expected one packed @carapace/ai candidate in $PACK_DIR" >&2
    exit 1
  fi
  AI_PACKAGE_TGZ="${ai_tarballs[0]}"
}

trap cleanup EXIT
carapace_e2e_enable_failure_diagnostics

run_with_timeout() {
  local timeout_ms="$1"
  shift
  node "$ROOT_DIR/scripts/e2e/lib/bun-global-install/assertions.mjs" \
    run-with-timeout \
    "$timeout_ms" \
    "$@"
}

reserve_runtime_ports() {
  node --input-type=module <<'NODE'
import net from "node:net";

const servers = [net.createServer(), net.createServer()];
await Promise.all(
  servers.map(
    (server) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      }),
  ),
);
console.log(servers.map((server) => server.address().port).join(" "));
await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
NODE
}

scrub_official_external_plugin_env() {
  local env_name
  while IFS= read -r env_name; do
    unset "$env_name"
  done < <(
    node --input-type=module - \
      "$ROOT_DIR/scripts/lib/official-external-provider-catalog.json" <<'NODE'
import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const envNames = new Set();
const visit = (value) => {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value.envVars)) {
    value.envVars.forEach((name) => envNames.add(name));
  }
  Object.values(value).forEach(visit);
};
visit(catalog);
console.log([...envNames].toSorted().join("\n"));
NODE
  )
}

resolve_package_tgz() {
  local -a package_args
  if [ -n "$PACKAGE_TGZ" ]; then
    if [ ! -f "$PACKAGE_TGZ" ]; then
      echo "CARAPACE_BUN_GLOBAL_SMOKE_PACKAGE_TGZ does not exist: $PACKAGE_TGZ" >&2
      exit 1
    fi
    PACKAGE_TGZ="$(cd "$(dirname "$PACKAGE_TGZ")" && pwd)/$(basename "$PACKAGE_TGZ")"
    return 0
  fi

  if [ -n "$DIST_IMAGE" ]; then
    docker_e2e_restore_package_dist_from_image "$DIST_IMAGE"
  elif [ "$HOST_BUILD" != "0" ]; then
    echo "==> Build host package artifacts"
    pnpm build
  else
    echo "==> Skipping host build (CARAPACE_BUN_GLOBAL_SMOKE_HOST_BUILD=0)"
  fi

  if [ ! -d "$ROOT_DIR/dist" ]; then
    echo "dist/ is missing; run pnpm build or set CARAPACE_BUN_GLOBAL_SMOKE_DIST_IMAGE" >&2
    exit 1
  fi

  PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/carapace-bun-pack.XXXXXX")"

  echo "==> Pack Carapace tarball"
  package_args=(
    --skip-build
    --output-dir "$PACK_DIR"
    --output-name carapace-current.tgz
  )
  if [[ "${CARAPACE_BUN_GLOBAL_SMOKE_ALLOW_UNRELEASED_CHANGELOG:-true}" == "true" ]]; then
    package_args+=(--allow-unreleased-changelog)
  fi
  PACKAGE_TGZ="$(
    node scripts/package-carapace-for-docker.mjs "${package_args[@]}"
  )"
  if [ -z "$PACKAGE_TGZ" ] || [ ! -f "$PACKAGE_TGZ" ]; then
    echo "missing packed Carapace tarball" >&2
    exit 1
  fi
}

main() {
  cd "$ROOT_DIR"

  if ! command -v "$BUN_BIN" >/dev/null 2>&1; then
    echo "Bun is required for bun global install smoke; set BUN_BIN or install bun." >&2
    exit 1
  fi

  resolve_package_tgz
  prepare_ai_candidate
  carapace_prepublish_plugin_registry_start_mounted \
    "$PACK_DIR/registry" REGISTRY_PID "$REQUIRED_REGISTRY_PACKAGES"

  local bun_path
  local bun_version
  local gateway_port
  local mock_port
  local carapace_entry
  local carapace_bin
  local package_root
  local success_marker
  bun_path="$(command -v "$BUN_BIN")"
  bun_version="$("$bun_path" --version)"
  node scripts/e2e/lib/bun-global-install/assertions.mjs assert-bun-version "$bun_version"
  SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/carapace-bun-global.XXXXXX")"

  export HOME="$SMOKE_DIR/home"
  export BUN_INSTALL="$HOME/.bun"
  export XDG_CACHE_HOME="$SMOKE_DIR/cache"
  export CARAPACE_NO_ONBOARD=1
  export CARAPACE_DISABLE_UPDATE_CHECK=1
  export CARAPACE_STATE_DIR="$SMOKE_DIR/state"
  export CARAPACE_CONFIG_PATH="$CARAPACE_STATE_DIR/carapace.json"
  scrub_official_external_plugin_env
  export OPENAI_API_KEY="carapace-bun-global-smoke-key"
  export CARAPACE_GATEWAY_TOKEN="carapace-bun-global-smoke-token"
  export NO_COLOR=1
  mkdir -p \
    "$HOME" \
    "$BUN_INSTALL/bin" \
    "$BUN_INSTALL/install/global" \
    "$XDG_CACHE_HOME" \
    "$CARAPACE_STATE_DIR"
  export PATH="$BUN_INSTALL/bin:$(dirname "$(command -v node)"):$PATH"
  # Source-export tarballs bundle AI; publication tarballs resolve it from the
  # prepared registry. Only bundled bytes need Bun's local dependency override.
  if [ -n "$AI_PACKAGE_TGZ" ]; then
    node --input-type=module - \
      "$BUN_INSTALL/install/global/package.json" \
      "$AI_PACKAGE_TGZ" <<'NODE'
import fs from "node:fs";

const [, , packageJsonPath, aiPackageTarball] = process.argv;
fs.writeFileSync(
  packageJsonPath,
  `${JSON.stringify({ private: true, overrides: { "@carapace/ai": `file:${aiPackageTarball}` } })}\n`,
);
NODE
  fi

  INSTALL_LOG="$SMOKE_DIR/install.log"
  UNTRUSTED_LOG="$SMOKE_DIR/untrusted.log"
  CLI_STATUS_LOG="$SMOKE_DIR/status.json"
  CLI_PLUGINS_LOG="$SMOKE_DIR/plugins.json"
  MOCK_LOG="$SMOKE_DIR/mock-openai.log"
  MOCK_REQUEST_LOG="$SMOKE_DIR/mock-openai-requests.jsonl"
  LOCAL_AGENT_LOG="$SMOKE_DIR/local-agent.log"
  GATEWAY_LOG="$SMOKE_DIR/gateway.log"
  GATEWAY_HEALTH_LOG="$SMOKE_DIR/gateway-health.json"
  GATEWAY_AGENT_LOG="$SMOKE_DIR/gateway-agent.log"

  echo "==> Install packed Carapace with trusted lifecycle scripts on Bun $bun_version"
  run_with_timeout "$COMMAND_TIMEOUT_MS" \
    "$bun_path" install -g --trust "$PACKAGE_TGZ" --no-progress >"$INSTALL_LOG" 2>&1

  carapace_bin="$BUN_INSTALL/bin/carapace"
  if [ ! -x "$carapace_bin" ]; then
    carapace_bin="$(command -v carapace || true)"
  fi
  if [ -z "$carapace_bin" ] || [ ! -x "$carapace_bin" ]; then
    echo "Bun global install did not create an executable carapace binary" >&2
    exit 1
  fi
  carapace_entry="$(
    node -e 'const fs = require("node:fs"); process.stdout.write(fs.realpathSync(process.argv[1]));' \
      "$carapace_bin"
  )"
  package_root="$(dirname "$carapace_entry")"
  export CARAPACE_E2E_REDACTOR_MODULE="$package_root/dist/plugin-sdk/logging-core.js"
  "$bun_path" scripts/docker/verify-fs-safe-native.mjs --package-root "$package_root" --mode require

  echo "==> Verify Carapace lifecycle scripts were trusted and executed"
  run_with_timeout "$COMMAND_TIMEOUT_MS" "$bun_path" pm -g untrusted >"$UNTRUSTED_LOG" 2>&1
  node scripts/e2e/lib/bun-global-install/assertions.mjs \
    assert-carapace-trusted \
    "$package_root" \
    "$BUN_INSTALL/install/global/package.json" \
    "$UNTRUSTED_LOG"

  echo "==> Carapace version through Bun global install"
  local carapace_version
  carapace_version="$(run_with_timeout "$COMMAND_TIMEOUT_MS" "$carapace_bin" --version)"
  printf "%s\n" "$carapace_version"

  echo "==> Carapace help through Bun global install"
  run_with_timeout "$COMMAND_TIMEOUT_MS" "$carapace_bin" --help >/dev/null

  run_bun_cli() {
    run_with_timeout "$COMMAND_TIMEOUT_MS" "$bun_path" "$carapace_entry" "$@"
  }

  echo "==> Installed package entry under Bun"
  run_bun_cli --version
  run_bun_cli --help >/dev/null
  pushd "$HOME" >/dev/null
  run_with_timeout "$COMMAND_TIMEOUT_MS" "$bun_path" run --bun carapace --version
  popd >/dev/null

  echo "==> Carapace image providers under Bun"
  local providers_json
  providers_json="$(run_bun_cli infer image providers --json)"
  CARAPACE_IMAGE_PROVIDERS_JSON="$providers_json" node scripts/e2e/lib/bun-global-install/assertions.mjs assert-image-providers

  read -r gateway_port mock_port < <(reserve_runtime_ports)
  success_marker="CARAPACE_BUN_GLOBAL_RUNTIME_OK"
  export SUCCESS_MARKER="$success_marker" MOCK_REQUEST_LOG
  node scripts/e2e/lib/bun-global-install/assertions.mjs \
    configure-runtime \
    "$CARAPACE_CONFIG_PATH" \
    "$mock_port" \
    "$gateway_port"

  echo "==> Representative CLI state under Bun"
  run_bun_cli status --json --timeout 1 >"$CLI_STATUS_LOG" 2>&1
  run_bun_cli plugins list --json >"$CLI_PLUGINS_LOG" 2>&1

  echo "==> Local mocked agent turn under Bun"
  MOCK_PID="$(carapace_e2e_start_mock_openai "$mock_port" "$MOCK_LOG")"
  carapace_e2e_wait_mock_openai "$mock_port"
  : >"$MOCK_REQUEST_LOG"
  run_bun_cli agent --local \
    --agent main \
    --session-id bun-global-local-agent \
    --message "Return marker $success_marker" \
    --thinking off \
    --json >"$LOCAL_AGENT_LOG" 2>&1
  node scripts/e2e/lib/bun-global-install/assertions.mjs \
    assert-agent-turn \
    "$success_marker" \
    "$LOCAL_AGENT_LOG" \
    "$MOCK_REQUEST_LOG"

  echo "==> Gateway health and mocked agent turn under Bun"
  : >"$MOCK_REQUEST_LOG"
  GATEWAY_PID="$(
    carapace_e2e_start_tracked_process \
      "$GATEWAY_LOG" \
      "$bun_path" \
      "$carapace_entry" \
      gateway \
      --port "$gateway_port" \
      --bind loopback
  )"
  carapace_e2e_wait_gateway_ready "$GATEWAY_PID" "$GATEWAY_LOG" 300 "$gateway_port"
  run_bun_cli gateway health \
    --token "$CARAPACE_GATEWAY_TOKEN" \
    --json >"$GATEWAY_HEALTH_LOG" 2>&1
  run_bun_cli agent \
    --agent main \
    --session-id bun-global-gateway-agent \
    --message "Return marker $success_marker" \
    --thinking off \
    --json >"$GATEWAY_AGENT_LOG" 2>&1
  node scripts/e2e/lib/bun-global-install/assertions.mjs \
    assert-agent-turn \
    "$success_marker" \
    "$GATEWAY_AGENT_LOG" \
    "$MOCK_REQUEST_LOG"

  echo "bun-global-install-smoke: Bun $bun_version package, CLI, local agent, and Gateway runtime OK"

  if [ -n "${CARAPACE_BUN_GLOBAL_SMOKE_PROOF_PATH:-}" ]; then
    node --input-type=module - \
      "$CARAPACE_BUN_GLOBAL_SMOKE_PROOF_PATH" \
      "$bun_path" \
      "$carapace_bin" \
      "$carapace_version" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const [, , proofPath, bunPath, carapacePath, carapaceVersion] = process.argv;
fs.mkdirSync(path.dirname(proofPath), { recursive: true });
fs.writeFileSync(
  proofPath,
  `${JSON.stringify({ bunPath, carapacePath, carapaceVersion }, null, 2)}\n`,
);
NODE
  fi
}

main "$@"
