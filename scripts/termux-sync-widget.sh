#!/data/data/com.termux/files/usr/bin/bash
# Carapace OAuth Sync Widget
# Syncs Claude Code tokens to Carapace over SSH
# Place in ~/.shortcuts/ on phone for Termux:Widget

termux-toast "Syncing Carapace auth..."

# Run sync on the configured Carapace host.
SERVER="${CARAPACE_SERVER:-carapace-host}"
RESULT=$(ssh "$SERVER" '$HOME/carapace/scripts/sync-claude-code-auth.sh' 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    # Extract expiry time from output
    EXPIRY=$(echo "$RESULT" | grep "Token expires:" | cut -d: -f2-)

    termux-vibrate -d 100
    termux-toast "Carapace synced! Expires:${EXPIRY}"

    # Optional: restart carapace service
    ssh "$SERVER" 'systemctl --user restart carapace' 2>/dev/null
else
    termux-vibrate -d 300
    termux-toast "Sync failed: ${RESULT}"
fi
