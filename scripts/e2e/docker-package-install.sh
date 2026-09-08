#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

# This mixed-platform lane owns its images; shared bare/functional tags belong to other lanes.
IMAGE_NAME="carapace-package-install-bare:$$"
MUSL_IMAGE_NAME="carapace-package-install-musl:$$"
PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz docker-package-install "${CARAPACE_CURRENT_PACKAGE_TGZ:-}")"
IDENTITY_PATH="${CARAPACE_DOCKER_ARTIFACT_IDENTITY_PATH:-$ROOT_DIR/.artifacts/docker-tests/docker-package-install-identities.json}"
NPM_PROOF_CONTAINER="carapace-package-npm-proof-$$"
PNPM_PROOF_CONTAINER="carapace-package-pnpm-proof-$$"
BUN_PROOF_CONTAINER="carapace-package-bun-proof-$$"
MUSL_PROOF_CONTAINER="carapace-package-musl-proof-$$"
DOCKER_RUN_TIMEOUT="${CARAPACE_DOCKER_PACKAGE_INSTALL_RUN_TIMEOUT:-120s}"
PACKAGE_HARNESS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/carapace-package-harness.XXXXXX")"
docker_e2e_package_mount_args "$PACKAGE_TGZ"

cleanup() {
  docker_e2e_docker_cmd rm -f \
    "$NPM_PROOF_CONTAINER" \
    "$PNPM_PROOF_CONTAINER" \
    "$BUN_PROOF_CONTAINER" \
    "$MUSL_PROOF_CONTAINER" >/dev/null 2>&1 || true
  docker_e2e_docker_cmd image rm "$IMAGE_NAME" "$MUSL_IMAGE_NAME" >/dev/null 2>&1 || true
  docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  rm -rf "$PACKAGE_HARNESS_DIR"
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" docker-package-install "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" bare
docker_e2e_build_or_reuse "$MUSL_IMAGE_NAME" docker-package-install-musl "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" musl

# The package proofs share the registry and lifecycle harness. Copy its complete
# script roots so all three managers install the same candidate dependency bytes.
for harness_path in \
  packages/normalization-core/src \
  scripts; do
  mkdir -p "$PACKAGE_HARNESS_DIR/$(dirname "$harness_path")"
  cp -R "$ROOT_DIR/$harness_path" "$PACKAGE_HARNESS_DIR/$harness_path"
done
chmod -R a+rX "$PACKAGE_HARNESS_DIR"

echo "Installing the real Carapace package artifact with npm as root..."
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run -d \
  --name "$NPM_PROOF_CONTAINER" \
  --user root \
  -e CARAPACE_FS_SAFE_NATIVE_CONTRACT \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -v "$PACKAGE_HARNESS_DIR:/repo:ro" \
  -v "$ROOT_DIR/scripts/docker/verify-fs-safe-native.mjs:/tmp/verify-fs-safe-native.mjs:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    npm install -g /tmp/carapace-current.tgz --no-fund --no-audit
    node /tmp/verify-fs-safe-native.mjs --package-root /usr/local/lib/node_modules/carapace --mode require
    test "$(command -v carapace)" = "/usr/local/bin/carapace"
    # Root installed the global package; a non-root user must still be able to
    # run it. A same-user install can never catch an installed tree that ends
    # up owner-only readable, which is how sudo-install breakage ships.
    runuser -u appuser -- carapace --version > /tmp/carapace-version
    runuser -u appuser -- carapace --help > /tmp/carapace-help
    test -s /tmp/carapace-help
    chmod 644 /tmp/carapace-version /tmp/carapace-help
    touch /tmp/carapace-proof-ready
    exec sleep infinity
  ' >/dev/null

echo "Installing the real Carapace package artifact with pnpm..."
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run -d \
  --name "$PNPM_PROOF_CONTAINER" \
  -e CARAPACE_FS_SAFE_NATIVE_CONTRACT \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -v "$PACKAGE_HARNESS_DIR:/repo:ro" \
  -v "$ROOT_DIR/scripts/docker/verify-fs-safe-native.mjs:/tmp/verify-fs-safe-native.mjs:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    export PNPM_HOME=/tmp/pnpm-home
    # pnpm stores global executables in the bin subdirectory of PNPM_HOME.
    export PATH="$PNPM_HOME/bin:$PATH"
    corepack prepare "$1" --activate
    pnpm add --global carapace@file:/tmp/carapace-current.tgz
    test "$(command -v carapace)" = "$PNPM_HOME/bin/carapace"
    pnpm list --global --json > /tmp/pnpm-packages.json
    package_root="$(node -p "require(\"/tmp/pnpm-packages.json\")[0].dependencies.carapace.path")"
    test -f "$package_root/package.json"
    # Tarball builds require their dependency path, relative to the install group.
    artifact_build="$(node -p "const path = require(\"node:path\"); \"carapace@file:\" + path.relative(path.resolve(process.argv[1], \"../..\"), \"/tmp/carapace-current.tgz\")" "$package_root")"
    pnpm approve-builds --global "$artifact_build"
    node /tmp/verify-fs-safe-native.mjs --package-root "$package_root" --mode require
    printf "%s\n" "$package_root" > /tmp/carapace-package-root
    carapace --version > /tmp/carapace-version
    carapace --help > /tmp/carapace-help
    test -s /tmp/carapace-help
    # A source install must follow checkout rebuilds without rewriting its package files.
    (
      export PNPM_HOME=/tmp/pnpm-source-link-home
      export PATH="$PNPM_HOME/bin:$PATH"
      mkdir -p /tmp/pnpm-source-link
      cd /tmp/pnpm-source-link
      node - "$1" <<"SOURCE_LINK"
const fs = require("node:fs");
fs.writeFileSync("package.json", JSON.stringify({
  name: "carapace-source-link-fixture", version: "1.0.0", packageManager: process.argv[2],
  bin: { "carapace-source-link-fixture": "cli.cjs" },
}));
fs.writeFileSync("pnpm-workspace.yaml", "packages: []\n");
fs.writeFileSync("pnpm-lock.yaml", "lockfileVersion: 9.0\n");
fs.writeFileSync("cli.cjs", "#!/usr/bin/env node\nconsole.log(1);\n", { mode: 0o755 });
SOURCE_LINK
      pnpm install
      for file in package.json pnpm-workspace.yaml pnpm-lock.yaml; do cp "$file" "$file.before"; done
      pnpm add --global "carapace-source-link-fixture@link:$PWD"
      test "$(carapace-source-link-fixture)" = 1
      node <<"SOURCE_LINK"
const fs = require("node:fs");
fs.writeFileSync("cli-next.cjs", "#!/usr/bin/env node\nconsole.log(2);\n", { mode: 0o755 });
fs.renameSync("cli-next.cjs", "cli.cjs");
SOURCE_LINK
      test "$(carapace-source-link-fixture)" = 2
      for file in package.json pnpm-workspace.yaml pnpm-lock.yaml; do cmp "$file" "$file.before"; done
    )
    touch /tmp/carapace-proof-ready
    exec sleep infinity
  ' -- "$(node -p "require('$ROOT_DIR/package.json').packageManager")" >/dev/null

echo "Installing the real Carapace package artifact with Bun..."
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run -d \
  --name "$BUN_PROOF_CONTAINER" \
  -e CARAPACE_FS_SAFE_NATIVE_CONTRACT \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -v "$PACKAGE_HARNESS_DIR:/repo:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    npm install -g --prefix /tmp/bun-runtime bun@1.4.0 --no-fund --no-audit
    cd /repo
    BUN_BIN=/tmp/bun-runtime/bin/bun \
      CARAPACE_BUN_GLOBAL_SMOKE_HOST_BUILD=0 \
      CARAPACE_BUN_GLOBAL_SMOKE_PACKAGE_TGZ=/tmp/carapace-current.tgz \
      CARAPACE_BUN_GLOBAL_SMOKE_PROOF_PATH=/tmp/carapace-bun-proof.json \
      bash scripts/e2e/bun-global-install-smoke.sh
    touch /tmp/carapace-proof-ready
    exec sleep infinity
  ' >/dev/null

echo "Installing the real Carapace package artifact with npm on musl..."
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run -d \
  --name "$MUSL_PROOF_CONTAINER" \
  -e CARAPACE_FS_SAFE_NATIVE_CONTRACT \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  "$MUSL_IMAGE_NAME" \
  sh -lc '
    set -eu
    npm install -g /tmp/carapace-current.tgz --no-fund --no-audit
    node /tmp/verify-fs-safe-native.mjs --package-root /usr/local/lib/node_modules/carapace --mode require
    touch /tmp/carapace-proof-ready
    exec sleep infinity
  ' >/dev/null

wait_for_proof() {
  local container_name="$1"
  for _ in $(seq 1 240); do
    if docker exec "$container_name" test -f /tmp/carapace-proof-ready; then
      return 0
    fi
    if [ "$(docker inspect --format '{{.State.Running}}' "$container_name")" != "true" ]; then
      docker logs "$container_name" >&2
      return 1
    fi
    sleep 1
  done
  docker logs "$container_name" >&2
  return 1
}

for container_name in "$NPM_PROOF_CONTAINER" "$PNPM_PROOF_CONTAINER" "$BUN_PROOF_CONTAINER" "$MUSL_PROOF_CONTAINER"; do
  wait_for_proof "$container_name"
done

NPM_PACKAGE_ROOT="/usr/local/lib/node_modules/carapace"
NPM_INSTALLED_VERSION="$(docker exec "$NPM_PROOF_CONTAINER" cat /tmp/carapace-version | tr -d '\r\n')"
PNPM_PACKAGE_ROOT="$(docker exec "$PNPM_PROOF_CONTAINER" cat /tmp/carapace-package-root | tr -d '\r\n')"
PNPM_PACKAGE_VERSION="$(docker exec "$PNPM_PROOF_CONTAINER" node -p "require('$PNPM_PACKAGE_ROOT/package.json').version")"
PNPM_INSTALLED_VERSION="$(docker exec "$PNPM_PROOF_CONTAINER" cat /tmp/carapace-version | tr -d '\r\n')"
BUN_CARAPACE_PATH="$(
  docker exec "$BUN_PROOF_CONTAINER" \
    node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/carapace-bun-proof.json", "utf8")).carapacePath'
)"
BUN_INSTALLED_VERSION="$(
  docker exec "$BUN_PROOF_CONTAINER" \
    node -p 'JSON.parse(require("node:fs").readFileSync("/tmp/carapace-bun-proof.json", "utf8")).carapaceVersion'
)"
PACKAGE_VERSION="$(docker exec "$NPM_PROOF_CONTAINER" node -p "require('$NPM_PACKAGE_ROOT/package.json').version")"
test "$PNPM_PACKAGE_VERSION" = "$PACKAGE_VERSION"
for installed_version in "$NPM_INSTALLED_VERSION" "$PNPM_INSTALLED_VERSION" "$BUN_INSTALLED_VERSION"; do
  if [[ "$installed_version" != *"$PACKAGE_VERSION"* ]]; then
    echo "installed CLI output $installed_version does not contain package version $PACKAGE_VERSION" >&2
    exit 1
  fi
done

# The legacy contract intentionally skips native verification; evidence must not
# present that omission as an executed native proof.
MUSL_FS_SAFE_NATIVE_OUTCOME="passed"
if [[ "${CARAPACE_FS_SAFE_NATIVE_CONTRACT:-required}" == "not-applicable" ]]; then
  MUSL_FS_SAFE_NATIVE_OUTCOME="not-applicable"
fi

node --import tsx "$ROOT_DIR/scripts/e2e/lib/docker-artifact-proof/write-identities.ts" \
  --scenario docker-package-install \
  --output "$IDENTITY_PATH" \
  --image "$IMAGE_NAME" \
  --package "$PACKAGE_TGZ" \
  --container "npm=$NPM_PROOF_CONTAINER" \
  --container "pnpm=$PNPM_PROOF_CONTAINER" \
  --container "bun=$BUN_PROOF_CONTAINER" \
  --container "musl=$MUSL_PROOF_CONTAINER" \
  --detail "npm:installedPackageRoot=$NPM_PACKAGE_ROOT" \
  --detail "npm:installedPackageVersion=$PACKAGE_VERSION" \
  --detail "npm:carapaceVersion=$NPM_INSTALLED_VERSION" \
  --detail "npm:carapacePath=/usr/local/bin/carapace" \
  --detail "npm:helpCommand=passed" \
  --detail "npm:nonRootExecution=passed" \
  --detail "musl:fsSafeNative=$MUSL_FS_SAFE_NATIVE_OUTCOME" \
  --detail "pnpm:installedPackageRoot=$PNPM_PACKAGE_ROOT" \
  --detail "pnpm:installedPackageVersion=$PNPM_PACKAGE_VERSION" \
  --detail "pnpm:carapaceVersion=$PNPM_INSTALLED_VERSION" \
  --detail "pnpm:carapacePath=/tmp/pnpm-home/bin/carapace" \
  --detail "pnpm:helpCommand=passed" \
  --detail "bun:installedPackageVersion=$PACKAGE_VERSION" \
  --detail "bun:carapaceVersion=$BUN_INSTALLED_VERSION" \
  --detail "bun:carapacePath=$BUN_CARAPACE_PATH" \
  --detail "bun:helpCommand=passed"

echo "npm, pnpm, and Bun package artifact proofs passed."
