#!/usr/bin/env bash
# our-fork sync: merge upstream main into the Exaggarate/openclaw fork and push.
# Prints exactly one verdict line for the automation relay to parse.
set -uo pipefail
cd /home/ubuntu/openclaw-fork || { echo "SYNC_FAIL cd-missing"; exit 0; }
LOG=/tmp/openclaw-fork-sync.log
: > "$LOG"
git fetch upstream -q >>"$LOG" 2>&1
BEHIND=$(git rev-list --count main..upstream/main 2>>"$LOG")
case "$BEHIND" in
  0) echo "SYNC_UPTODATE"; exit 0 ;;
  ''|*[!0-9]*) echo "SYNC_FAIL rev-list:$(tail -3 "$LOG" | tr '\n' ' ')" ; exit 0 ;;
esac
if git merge upstream/main -X theirs --no-edit -m "sync: upstream main [our-fork]" >>"$LOG" 2>&1 \
   && git push origin main -q >>"$LOG" 2>&1; then
  echo "SYNC_OK $BEHIND"
else
  echo "SYNC_FAIL merge-or-push:$(tail -3 "$LOG" | tr '\n' ' ')"
fi
exit 0