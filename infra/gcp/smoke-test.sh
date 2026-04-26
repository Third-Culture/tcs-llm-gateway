#!/usr/bin/env bash
# Deterministic smoke test for a deployed LLM Gateway environment.
#
# Required env:
#   GATEWAY_URL      e.g. https://gateway-staging.thirdculture.world
#   GATEWAY_API_KEY  a gateway API key with permission to call the auto router
#
# Optional env:
#   SMOKE_MODEL      override the model (default: auto)
#   SMOKE_TASK       override the task profile id (default: company_refresh_json)
#   SMOKE_TIMEOUT    curl timeout in seconds (default: 60)
#
# Exit code 0 means every assertion passed.

set -euo pipefail

: "${GATEWAY_URL:?GATEWAY_URL is required}"
: "${GATEWAY_API_KEY:?GATEWAY_API_KEY is required}"

MODEL="${SMOKE_MODEL:-auto}"
TASK="${SMOKE_TASK:-company_refresh_json}"
TIMEOUT="${SMOKE_TIMEOUT:-60}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32mok\033[0m %s\n" "$*"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$*" >&2; exit 1; }

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    fail "jq is required but not installed"
  fi
}
require_curl() {
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl is required but not installed"
  fi
}

require_jq
require_curl

bold "1. health check"
HEALTH_FILE=$(mktemp)
HEALTH_HTTP_STATUS=$(curl -sS -o "$HEALTH_FILE" -w "%{http_code}" \
  --max-time "$TIMEOUT" \
  "$GATEWAY_URL/")
if [[ "$HEALTH_HTTP_STATUS" != "200" ]]; then
  cat "$HEALTH_FILE" >&2
  fail "expected 200 from $GATEWAY_URL/, got $HEALTH_HTTP_STATUS"
fi
HEALTH_STATUS=$(jq -r '.health.status // empty' "$HEALTH_FILE")
if [[ "$HEALTH_STATUS" != "ok" ]]; then
  cat "$HEALTH_FILE" >&2
  fail "health.status was '$HEALTH_STATUS' (expected 'ok')"
fi
ok "health.status=ok"
rm -f "$HEALTH_FILE"

bold "2. auto routing with task profile"
REQUEST_FILE=$(mktemp)
RESPONSE_FILE=$(mktemp)
cat >"$REQUEST_FILE" <<EOF
{
  "model": "$MODEL",
  "messages": [
    {"role": "system", "content": "You return strict JSON."},
    {"role": "user", "content": "Return {\"ok\": true} as JSON."}
  ],
  "response_format": {"type": "json_object"},
  "task": "$TASK"
}
EOF

CHAT_HTTP_STATUS=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
  --max-time "$TIMEOUT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -X POST \
  --data-binary @"$REQUEST_FILE" \
  "$GATEWAY_URL/v1/chat/completions")

if [[ "$CHAT_HTTP_STATUS" != "200" ]]; then
  cat "$RESPONSE_FILE" >&2
  fail "expected 200 from /v1/chat/completions, got $CHAT_HTTP_STATUS"
fi

CHOICE_CONTENT=$(jq -r '.choices[0].message.content // empty' "$RESPONSE_FILE")
if [[ -z "$CHOICE_CONTENT" ]]; then
  cat "$RESPONSE_FILE" >&2
  fail "response had no choices[0].message.content"
fi
if ! printf '%s' "$CHOICE_CONTENT" | jq -e . >/dev/null 2>&1; then
  printf 'content: %s\n' "$CHOICE_CONTENT" >&2
  fail "choices[0].message.content is not valid JSON"
fi
ok "choices[0].message.content parses as JSON"

USED_MODEL=$(jq -r '.model // empty' "$RESPONSE_FILE")
if [[ -z "$USED_MODEL" ]]; then
  fail "response did not record .model"
fi
ok "selected model: $USED_MODEL"

USAGE_TOTAL=$(jq -r '.usage.total_tokens // empty' "$RESPONSE_FILE")
if [[ -z "$USAGE_TOTAL" ]]; then
  fail "response did not include usage.total_tokens"
fi
ok "usage.total_tokens=$USAGE_TOTAL"

COST=$(jq -r '.usage.cost // .x_llmgateway.cost // empty' "$RESPONSE_FILE")
if [[ -n "$COST" ]]; then
  ok "billable cost reported: $COST"
else
  printf "  note: no cost field in response; verify in gateway logs.\n"
fi

rm -f "$REQUEST_FILE" "$RESPONSE_FILE"

bold "smoke test passed"
