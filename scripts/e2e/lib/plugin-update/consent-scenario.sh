#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/carapace-e2e-instance.sh
carapace_e2e_eval_test_state_from_b64 "${CARAPACE_TEST_STATE_SCRIPT_B64:?missing isolated state}"
carapace_e2e_install_package /tmp/consent-install.log "mounted Carapace package" /tmp/consent-prefix
package_root="$(carapace_e2e_package_root /tmp/consent-prefix)"
entry="$(carapace_e2e_package_entrypoint "$package_root")"
export PATH="/tmp/consent-prefix/bin:$PATH"
export NPM_CONFIG_PREFIX=/tmp/consent-prefix
node scripts/e2e/lib/plugin-update/probe.mjs consent "$entry" "$CARAPACE_CURRENT_PACKAGE_TGZ"
