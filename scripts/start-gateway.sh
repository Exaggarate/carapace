#!/usr/bin/env bash
# Launcher for the Carapace gateway (used by ecosystem.config.cjs / pm2).
#
# Sources ~/.carapace/gateway.env (KEY=VALUE lines) so credentials live outside
# the repo and outside pm2's own dump; a missing env file is fine — config.json
# and SecretRefs still resolve as usual. Then execs the compiled CLI so the
# monitored PID becomes node itself.
#
# Example gateway.env (never commit real values):
#   CARAPACE_TELEGRAM_TOKEN=123456:AA...
#   CARAPACE_LLM_API_KEY=sk-...
#   CARAPACE_API_TOKEN=some-bearer-token
set -euo pipefail

ENV_FILE="${CARAPACE_GATEWAY_ENV:-$HOME/.carapace/gateway.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

cd "$(dirname "$0")/.."
exec node dist/cli/index.js gateway