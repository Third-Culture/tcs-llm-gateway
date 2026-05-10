#!/usr/bin/env bash
# Manage the thirdculture.systems CNAMEs that front the TCS LLM Gateway
# via GoDaddy's DNS API.
#
# Usage:
#   ./godaddy-dns.sh verify       # print currently-configured records
#   ./godaddy-dns.sh apply        # upsert llm + api.llm CNAMEs
#   ./godaddy-dns.sh apply-txt <host> <value>   # create a single TXT record
#                                                 (used for domain verification)
#
# Credentials (in order of preference):
#   1. Env vars GODADDY_API_KEY + GODADDY_API_SECRET
#   2. 1Password item "Godaddy" in the "TCS Team" vault, fields:
#        key       -> API key
#        secret    -> API secret
#
# Requires: curl, jq, (and `op` if relying on 1Password).

set -euo pipefail

DOMAIN="${TCS_DNS_DOMAIN:-thirdculture.systems}"
CNAME_TARGET="${TCS_CNAME_TARGET:-ghs.googlehosted.com}"
API_HOST="${GODADDY_API_HOST:-https://api.godaddy.com}"

log() { printf "\033[1;34m[godaddy-dns]\033[0m %s\n" "$*"; }

load_creds() {
  if [[ -n "${GODADDY_API_KEY:-}" && -n "${GODADDY_API_SECRET:-}" ]]; then
    return
  fi
  if command -v op >/dev/null; then
    log "loading GoDaddy creds from 1Password (TCS Team / Godaddy)"
    GODADDY_API_KEY="$(op item get "Godaddy" --vault "TCS Team" --fields label=key --reveal 2>/dev/null || true)"
    GODADDY_API_SECRET="$(op item get "Godaddy" --vault "TCS Team" --fields label=secret --reveal 2>/dev/null || true)"
  fi
  if [[ -z "${GODADDY_API_KEY:-}" || -z "${GODADDY_API_SECRET:-}" ]]; then
    echo "Missing credentials. Set GODADDY_API_KEY + GODADDY_API_SECRET, or populate a 1Password item 'Godaddy' in 'TCS Team' with 'key' and 'secret' fields." >&2
    exit 1
  fi
}

auth_header() {
  echo "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}"
}

list_records() {
  local type="$1" name="$2"
  curl -sS -H "$(auth_header)" -H "Accept: application/json" \
    "${API_HOST}/v1/domains/${DOMAIN}/records/${type}/${name}"
}

upsert_cname() {
  local host="$1" target="$2"
  log "upserting CNAME ${host}.${DOMAIN} -> ${target}"
  local payload
  payload="$(jq -cn --arg data "$target" '[{ "data": $data, "ttl": 3600 }]')"
  curl -sS -X PUT \
    -H "$(auth_header)" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    --data "$payload" \
    "${API_HOST}/v1/domains/${DOMAIN}/records/CNAME/${host}" \
    -o /tmp/godaddy-dns.$$.json -w "  HTTP %{http_code}\n"
  if [[ -s /tmp/godaddy-dns.$$.json ]]; then
    cat /tmp/godaddy-dns.$$.json
    echo
  fi
  rm -f /tmp/godaddy-dns.$$.json
}

upsert_txt() {
  local host="$1" value="$2"
  log "upserting TXT ${host}.${DOMAIN} -> ${value}"
  local payload
  payload="$(jq -cn --arg data "$value" '[{ "data": $data, "ttl": 600 }]')"
  curl -sS -X PUT \
    -H "$(auth_header)" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    --data "$payload" \
    "${API_HOST}/v1/domains/${DOMAIN}/records/TXT/${host}" \
    -o /tmp/godaddy-dns.$$.json -w "  HTTP %{http_code}\n"
  if [[ -s /tmp/godaddy-dns.$$.json ]]; then
    cat /tmp/godaddy-dns.$$.json
    echo
  fi
  rm -f /tmp/godaddy-dns.$$.json
}

verify() {
  for host in llm api.llm; do
    log "CNAME ${host}.${DOMAIN}:"
    list_records CNAME "$host" | jq .
  done
  log "TXT @ (domain-level verification records):"
  list_records TXT "@" | jq '[.[] | select(.data | test("google-site-verification|cloud-run"))]'
}

apply() {
  upsert_cname "llm" "$CNAME_TARGET"
  upsert_cname "api.llm" "$CNAME_TARGET"
  log "done. DNS propagation takes 5-30 minutes on GoDaddy."
  log "Cloud Run TLS certs provision automatically once DNS resolves; allow up to 60 minutes."
}

main() {
  if ! command -v jq >/dev/null; then
    echo "jq is required." >&2; exit 1
  fi
  load_creds
  case "${1:-}" in
    verify) verify ;;
    apply) apply ;;
    apply-txt)
      if [[ $# -ne 3 ]]; then
        echo "usage: $0 apply-txt <host> <value>" >&2; exit 1
      fi
      upsert_txt "$2" "$3"
      ;;
    ""|-h|--help)
      sed -n '2,24p' "$0" ;;
    *) echo "unknown command: $1" >&2; exit 1 ;;
  esac
}

main "$@"
