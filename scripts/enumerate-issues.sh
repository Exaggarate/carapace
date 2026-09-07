#!/usr/bin/env bash
# Enumerate ALL open issues of openclaw/openclaw into our-fork/issues-full.json.
# Token is read internally from the host git-credentials file and used via a
# 0600-perm header file — never printed, never passed on a command line.
set -uo pipefail
cd /home/ubuntu/openclaw-fork || { echo "ENUM_FAIL cd"; exit 0; }

TOKEN=$(grep -o 'https://[^:/@]*:[^@]*@github\.com' "$HOME/.git-credentials" 2>/dev/null | head -1 \
  | sed 's|^https://||; s|@github\.com$||' | cut -d: -f2-)
if [ -z "$TOKEN" ]; then echo "ENUM_FAIL no-token"; exit 0; fi

umask 077
HDR=$(mktemp)
printf 'Authorization: token %s\n' "$TOKEN" > "$HDR"

OUT=our-fork/issues-full.json
: > "$OUT"
PAGE=1
while :; do
  RESP=$(curl -s -H @"$HDR" "https://api.github.com/repos/openclaw/openclaw/issues?state=open&per_page=100&page=$PAGE")
  if echo "$RESP" | jq -e '.message' >/dev/null 2>&1; then
    echo "ENUM_FAIL api:$(echo "$RESP" | jq -r '.message' | head -c 120) page:$PAGE"
    rm -f "$HDR"; exit 0
  fi
  echo "$RESP" | jq -c '.[] | select(.pull_request == null) | {n:.number,t:.title,l:[.labels[].name],c:.comments,cr:.created_at,u:.updated_at}' >> "$OUT" 2>/dev/null
  TOTAL=$(echo "$RESP" | jq 'length' 2>/dev/null || echo 0)
  [ "$TOTAL" -lt 100 ] && break
  PAGE=$((PAGE+1))
  sleep 0.3
done
rm -f "$HDR"
LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "ENUM_DONE issues:$LINES pages:$PAGE"
exit 0