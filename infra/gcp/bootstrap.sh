#!/usr/bin/env bash
# Idempotent bootstrap for tcs-llm-gateway on GCP.
#
# Enables the Google Cloud services we need, creates the Artifact Registry
# repository, and pre-seeds Secret Manager with empty placeholders for every
# LLM_* API key the gateway expects. Safe to run multiple times.
#
# Usage:
#   ./bootstrap.sh                 # normal bootstrap
#   ./bootstrap.sh --destroy-secrets   # remove the placeholder secrets (danger)
#
# Requires: gcloud CLI authenticated as a user/SA with Project Editor on
# `third-culture` (or the roles listed in terraform/main.tf).

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
REGION="${TCS_GCP_REGION:-us-central1}"
REPO_NAME="${TCS_ARTIFACT_REPO:-tcs}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"

# The gateway only reads secrets that actually have provider keys — mounting a
# placeholder is harmless because the gateway ignores providers whose keys are
# empty strings.
PROVIDER_SECRETS=(
  LLM_FIREWORKS_API_KEY
  LLM_PARASAIL_API_KEY
  LLM_DEEPINFRA_API_KEY
  LLM_WANDB_API_KEY
  LLM_GOOGLE_VERTEX_API_KEY
  LLM_MOONSHOT_API_KEY
  LLM_MINIMAX_API_KEY
  LLM_CANOPY_WAVE_API_KEY
  LLM_TOGETHER_AI_API_KEY
  LLM_NOVITA_AI_API_KEY
  LLM_OPENAI_API_KEY
  LLM_ANTHROPIC_API_KEY
)

# Secrets the gateway itself needs to operate.
INTERNAL_SECRETS=(
  TCS_LLM_DATABASE_URL
  TCS_LLM_REDIS_PASSWORD
  TCS_LLM_AUTH_SECRET
  GATEWAY_API_KEY_HASH_SECRET
  TCS_SLACK_BUDGET_WEBHOOK_URL
  TCS_LINEAR_API_KEY
  TCS_LINEAR_BUDGET_TEAM_ID
  TCS_LLM_INTERNAL_STATS_TOKEN
)

GCP_APIS=(
  run.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  sqladmin.googleapis.com
  redis.googleapis.com
  vpcaccess.googleapis.com
  secretmanager.googleapis.com
  servicenetworking.googleapis.com
  compute.googleapis.com
  iap.googleapis.com
  aiplatform.googleapis.com
  cloudresourcemanager.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com
)

log() { printf "\033[1;34m[bootstrap]\033[0m %s\n" "$*"; }

confirm_project() {
  local current
  current="$("$GCLOUD" config get project 2>/dev/null || true)"
  if [[ "$current" != "$PROJECT" ]]; then
    log "Switching active project $current -> $PROJECT"
    "$GCLOUD" config set project "$PROJECT" >/dev/null
  fi
}

enable_apis() {
  log "Enabling ${#GCP_APIS[@]} GCP APIs (no-op if already enabled)"
  "$GCLOUD" services enable "${GCP_APIS[@]}" --project "$PROJECT"
}

ensure_artifact_registry() {
  local existing
  existing="$("$GCLOUD" artifacts repositories describe "$REPO_NAME" \
    --location="$REGION" --project "$PROJECT" --format=value\(name\) 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    log "Artifact Registry repo $REPO_NAME already exists"
    return
  fi
  log "Creating Artifact Registry repo $REPO_NAME ($REGION)"
  "$GCLOUD" artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="TCS container images (llm-gateway, etc.)" \
    --project "$PROJECT"
}

ensure_secret_placeholder() {
  local name="$1"
  local existing
  existing="$("$GCLOUD" secrets describe "$name" --project "$PROJECT" --format=value\(name\) 2>/dev/null || true)"
  if [[ -n "$existing" ]]; then
    return
  fi
  log "Creating Secret Manager placeholder $name"
  # Secret Manager rejects empty payloads, so we seed with a single space.
  # populate-secrets.sh will overwrite with the real value when available.
  "$GCLOUD" secrets create "$name" \
    --replication-policy=automatic \
    --labels=service=tcs-llm-gateway \
    --project "$PROJECT"
  printf ' ' | "$GCLOUD" secrets versions add "$name" --data-file=- --project "$PROJECT" >/dev/null
}

ensure_all_secrets() {
  log "Seeding ${#PROVIDER_SECRETS[@]} provider secrets + ${#INTERNAL_SECRETS[@]} internal secrets"
  for s in "${PROVIDER_SECRETS[@]}" "${INTERNAL_SECRETS[@]}"; do
    ensure_secret_placeholder "$s"
  done
  log "Populate real values with:  gcloud secrets versions add <NAME> --data-file=- --project $PROJECT"
}

destroy_secrets() {
  log "Destroying placeholder secrets (requires explicit confirmation)"
  for s in "${PROVIDER_SECRETS[@]}" "${INTERNAL_SECRETS[@]}"; do
    "$GCLOUD" secrets delete "$s" --project "$PROJECT" --quiet || true
  done
}

main() {
  confirm_project
  if [[ "${1:-}" == "--destroy-secrets" ]]; then
    destroy_secrets
    return
  fi
  enable_apis
  ensure_artifact_registry
  ensure_all_secrets
  log "Bootstrap complete. Next: populate secret values, then run terraform apply."
}

main "$@"
