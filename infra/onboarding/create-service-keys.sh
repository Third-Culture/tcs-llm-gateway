#!/usr/bin/env bash
# Creates one API key per TCS service by calling the tcs-llm-gateway admin API.
#
# Reads infra/onboarding/services.json for the list of services and their
# monthly budgets. For each service, if a matching key (by description) does
# not already exist, creates a new one with monthly period usage limit and
# stores the resulting token in 1Password under the vault `TCS Team`.
#
# Idempotent. Safe to re-run — existing keys are left untouched.
#
# Usage:
#   ./create-service-keys.sh \
#       --api-url https://api.llm.thirdculture.systems \
#       --admin-token <session-token-from-dashboard> \
#       --project-id <project-id-from-dashboard>
#
# Required: an admin session cookie/token from the dashboard. Easiest way:
# sign into https://llm.thirdculture.systems, then copy the value of the
# `better-auth.session_token` cookie from devtools.

set -euo pipefail

API_URL=""
ADMIN_TOKEN=""
PROJECT_ID=""
OP_VAULT="TCS Team"
SERVICES_FILE="$(cd "$(dirname "$0")" && pwd)/services.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)       API_URL="$2"; shift 2 ;;
    --admin-token)   ADMIN_TOKEN="$2"; shift 2 ;;
    --project-id)    PROJECT_ID="$2"; shift 2 ;;
    --op-vault)      OP_VAULT="$2"; shift 2 ;;
    --services-file) SERVICES_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$API_URL" || -z "$ADMIN_TOKEN" || -z "$PROJECT_ID" ]]; then
  echo "Missing required args. Use --help." >&2
  exit 1
fi

if ! command -v jq >/dev/null; then
  echo "jq is required." >&2; exit 1
fi

log() { printf "\033[1;34m[onboarding]\033[0m %s\n" "$*"; }

auth_header=(-H "Cookie: __Secure-better-auth.session_token=${ADMIN_TOKEN}")

existing_keys_json="$(curl -sS --fail \
  "${auth_header[@]}" \
  "${API_URL}/keys/api?projectId=${PROJECT_ID}&filter=all" | jq -c)"

service_exists() {
  local desc="$1"
  echo "$existing_keys_json" | jq -e --arg d "$desc" \
    '.apiKeys[] | select(.description == $d)' >/dev/null
}

create_service_key() {
  local name="$1" desc="$2" budget="$3"
  local payload
  payload="$(jq -cn \
    --arg description "$desc" \
    --arg projectId "$PROJECT_ID" \
    --argjson budget "$budget" \
    '{
      description: $description,
      projectId: $projectId,
      periodUsageLimit: ($budget|tostring),
      periodUsageDurationValue: 1,
      periodUsageDurationUnit: "month"
    }')"

  local response
  response="$(curl -sS --fail \
    "${auth_header[@]}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data "$payload" \
    "${API_URL}/keys/api")"

  local token
  token="$(echo "$response" | jq -r '.apiKey.token')"
  if [[ -z "$token" || "$token" == "null" ]]; then
    echo "Failed to extract token for $name. Response:" >&2
    echo "$response" >&2
    return 1
  fi

  if command -v op >/dev/null; then
    local item_title="tcs-llm-gateway / ${name}"
    if op item get "$item_title" --vault "$OP_VAULT" >/dev/null 2>&1; then
      op item edit "$item_title" --vault "$OP_VAULT" password="$token" >/dev/null
    else
      op item create \
        --vault "$OP_VAULT" \
        --category "API Credential" \
        --title "$item_title" \
        "credential=$token" \
        "url=${API_URL}" \
        --tags "tcs-llm-gateway,${name}" >/dev/null
    fi
    log "stored $name key in 1Password ($OP_VAULT / $item_title)"
  else
    log "1Password CLI not available — print the token manually:"
    echo "  $name: $token"
  fi
}

services_count="$(jq '.services | length' "$SERVICES_FILE")"
log "onboarding $services_count services"

for i in $(seq 0 $((services_count - 1))); do
  name="$(jq -r ".services[$i].name" "$SERVICES_FILE")"
  desc="$(jq -r ".services[$i].description" "$SERVICES_FILE")"
  budget="$(jq -r ".services[$i].monthly_budget_usd" "$SERVICES_FILE")"
  full_desc="${name} — ${desc}"

  if service_exists "$full_desc"; then
    log "$name: key already exists, skipping"
    continue
  fi

  log "$name: creating key with \$${budget}/month budget"
  create_service_key "$name" "$full_desc" "$budget"
done

log "done."
