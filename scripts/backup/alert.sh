#!/usr/bin/env bash
# Posts a short alert to OPS_ALERT_WEBHOOK_URL (secret, passed as URL) when it is set.
# GitHub also emails the failure to the account that last changed the workflow.
set -uo pipefail
[[ -z "${URL:-}" ]] && exit 0
text="⚠️ Clinic platform: $1 — $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
body=$(jq -n --arg t "$text" '{text: $t, content: $t}')
curl -fsS -m 10 -H 'content-type: application/json' -d "$body" "$URL" > /dev/null || true
