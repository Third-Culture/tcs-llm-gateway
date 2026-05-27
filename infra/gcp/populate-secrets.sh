#!/usr/bin/env bash
# Upsert TCS LLM Gateway secrets into GCP Secret Manager from env vars or
# 1Password. Idempotent: only writes a new secret version when the value
# differs from the current latest.
#
# Usage:
#   ./populate-secrets.sh                  # upsert all configured secrets
#   ./populate-secrets.sh LLM_DEEPINFRA_API_KEY [...]  # only the named ones
#
# Sources (in order of preference) per secret:
#   1. Environment variable of the same name (e.g. LLM_DEEPINFRA_API_KEY)
#   2. 1Password reference declared below (empty -> skip, leaves placeholder)
#
# Extend MAPPINGS when adding a new provider or internal secret.

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"

log() { printf "\033[1;34m[secrets]\033[0m %s\n" "$*"; }

# Each entry: SECRET_NAME|OP_VAULT|OP_ITEM|OP_FIELD
# Leave OP_* empty to skip 1Password lookup for that secret.
MAPPINGS=(
  "LLM_DEEPINFRA_API_KEY|di-accounts|Deepinfra|credential"
  "LLM_WANDB_API_KEY|di-accounts|Weights and Biases|credential"
  "LLM_FIREWORKS_API_KEY|TCS Team|Fireworks AI|credential"
  "LLM_PARASAIL_API_KEY|TCS Team|Parasail|credential"
  "LLM_GOOGLE_AI_STUDIO_API_KEY|di-accounts|Gemini|credential"
  "LLM_GOOGLE_VERTEX_API_KEY|||"
  "LLM_MOONSHOT_API_KEY|TCS Team|Moonshot|credential"
  "LLM_MINIMAX_API_KEY|TCS Team|MiniMax|credential"
  "LLM_CANOPY_WAVE_API_KEY|TCS Team|Canopywave|credential"
  "LLM_TOGETHER_AI_API_KEY|TCS Team|Together AI|credential"
  "LLM_NOVITA_AI_API_KEY|TCS Team|Novita|credential"
  "LLM_OPENAI_API_KEY|TCS Team|OpenAI|credential"
  "LLM_ANTHROPIC_API_KEY|TCS Team|Anthropic|credential"
  "TCS_SLACK_BUDGET_WEBHOOK_URL|TCS Team|TCS LLM Budget Slack Webhook|url"
  "TCS_LINEAR_API_KEY|TCS Team|Linear API Bot|credential"
  "TCS_LINEAR_BUDGET_TEAM_ID|||"
  "TCS_LLM_AUTH_SECRET|||"
)

current_secret() {
  "$GCLOUD" secrets versions access latest --secret="$1" --project "$PROJECT" 2>/dev/null || true
}

maybe_write_secret() {
  local name="$1" value="$2" source="$3"
  if [[ -z "$value" ]]; then
    log "$name: no source value, leaving placeholder"
    return
  fi
  local current
  current="$(current_secret "$name")"
  if [[ "$current" == "$value" ]]; then
    log "$name: already up-to-date"
    return
  fi
  log "$name: writing new version from $source"
  printf '%s' "$value" | "$GCLOUD" secrets versions add "$name" --data-file=- --project "$PROJECT" >/dev/null
}

gen_random_hex() {
  head -c 48 /dev/urandom | base64 | tr -d '=+/' | head -c 64
}

process_secret() {
  local entry="$1"
  IFS='|' read -r name vault item field <<< "$entry"

  # 1. Env var
  local env_val="${!name:-}"
  if [[ -n "$env_val" ]]; then
    maybe_write_secret "$name" "$env_val" "env"
    return
  fi

  # 2. 1Password (optional)
  if [[ -n "$vault" && -n "$item" && -n "$field" ]] && command -v op >/dev/null; then
    local op_val
    op_val="$(op item get "$item" --vault "$vault" --fields "label=${field}" --reveal 2>/dev/null || true)"
    if [[ -n "$op_val" ]]; then
      maybe_write_secret "$name" "$op_val" "1Password ($vault/$item/$field)"
      return
    fi
  fi

  # 3. Auto-generate the internal auth secret if it doesn't exist yet.
  if [[ "$name" == "TCS_LLM_AUTH_SECRET" ]]; then
    local current
    current="$(current_secret "$name")"
    if [[ -n "$current" ]]; then
      log "$name: keeping existing auto-generated value"
    else
      maybe_write_secret "$name" "$(gen_random_hex)" "auto-generated"
    fi
    return
  fi

  log "$name: no source value, leaving placeholder (set \$$name or add to 1Password)"
}

main() {
  if [[ ! -x "$GCLOUD" ]]; then
    echo "gcloud not found at $GCLOUD" >&2; exit 1
  fi

  local targets=("$@")
  if [[ ${#targets[@]} -eq 0 ]]; then
    for entry in "${MAPPINGS[@]}"; do
      process_secret "$entry"
    done
  else
    for target in "${targets[@]}"; do
      local matched=0
      for entry in "${MAPPINGS[@]}"; do
        local n="${entry%%|*}"
        if [[ "$n" == "$target" ]]; then
          process_secret "$entry"
          matched=1
          break
        fi
      done
      (( matched == 0 )) && log "unknown secret: $target"
    done
  fi
}

main "$@"
