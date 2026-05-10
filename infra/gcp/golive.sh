#!/usr/bin/env bash
# Master go-live runbook for TCS LLM Gateway.
#
# Run in phases so each step is interruptible and auditable. Every phase is
# idempotent — re-running a phase that's already complete is a no-op.
#
# Usage:
#   ./golive.sh preflight   # check auth + tooling before anything mutates
#   ./golive.sh bootstrap   # enable GCP APIs, create AR repo, seed secrets
#   ./golive.sh secrets     # upsert provider API keys from env/1P
#   ./golive.sh wif         # set up Workload Identity Federation for CI/CD
#   ./golive.sh build       # build + push unified Docker image
#   ./golive.sh tf-plan     # terraform plan (review before apply)
#   ./golive.sh tf-apply    # terraform apply (provisions paid resources)
#   ./golive.sh dns         # upsert llm + api.llm CNAMEs via GoDaddy API
#   ./golive.sh monitoring  # create log metrics + dashboard
#   ./golive.sh smoketest   # end-to-end curl against the gateway
#   ./golive.sh all         # run every phase in order, stopping on error

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
REGION="${TCS_GCP_REGION:-us-central1}"
REPO_URL="${TCS_REPO_URL:-Third-Culture/tcs-llm-gateway}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"
IMAGE_TAG="${TCS_IMAGE_TAG:-tcs-$(cd "$(dirname "$0")/../.." && git rev-parse --short HEAD 2>/dev/null || echo manual)}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AR_IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/tcs/llm-gateway:${IMAGE_TAG}"

log() { printf "\033[1;34m[golive]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[golive]\033[0m %s\n" "$*" >&2; }

preflight() {
  local ok=1
  log "checking gcloud auth"
  if ! "$GCLOUD" auth print-access-token >/dev/null 2>&1; then
    err "gcloud user creds expired. run:  gcloud auth login"
    ok=0
  fi
  if ! "$GCLOUD" auth application-default print-access-token >/dev/null 2>&1; then
    err "ADC expired. run:  gcloud auth application-default login"
    ok=0
  fi
  log "checking Docker (optional: Cloud Build is used when missing)"
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    log "docker available — local builds possible"
  else
    log "docker not available — will fall back to Cloud Build"
  fi
  log "checking terraform"
  if ! command -v terraform >/dev/null; then
    err "terraform not installed. brew install terraform OR download to ~/bin"
    ok=0
  fi
  log "checking jq"
  if ! command -v jq >/dev/null; then
    err "jq not installed. brew install jq OR download to ~/bin"
    ok=0
  fi
  if (( ok == 0 )); then
    exit 1
  fi
  log "preflight OK. Active account: $("$GCLOUD" config get account)"
  log "active project: $("$GCLOUD" config get project)"
}

bootstrap() {
  log "running bootstrap.sh"
  "$(dirname "$0")/bootstrap.sh"
}

secrets() {
  log "upserting provider secrets"
  "$(dirname "$0")/populate-secrets.sh"
}

wif() {
  log "setting up Workload Identity Federation"
  "$(dirname "$0")/setup-wif.sh" "$REPO_URL"
}

build_image() {
  cd "$ROOT_DIR"
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    log "building unified image (amd64) locally via docker buildx"
    "$GCLOUD" auth configure-docker "${REGION}-docker.pkg.dev" --quiet >/dev/null
    docker buildx create --use --name tcs-llm-builder >/dev/null 2>&1 || docker buildx use tcs-llm-builder
    docker buildx build \
      --platform linux/amd64 \
      --file infra/unified.dockerfile \
      --tag "$AR_IMAGE" \
      --tag "${REGION}-docker.pkg.dev/${PROJECT}/tcs/llm-gateway:latest" \
      --push \
      .
  else
    log "no local docker — submitting build to Cloud Build"
    "$GCLOUD" builds submit \
      --project "$PROJECT" \
      --region "$REGION" \
      --config infra/gcp/cloudbuild.yaml \
      --substitutions "_REGION=${REGION},_REPO=tcs,_IMAGE=llm-gateway,_TAG=${IMAGE_TAG}" \
      .
  fi
  log "pushed $AR_IMAGE"
}

tf_plan() {
  cd "$ROOT_DIR/infra/gcp/terraform"
  [[ -f tcs.tfvars ]] || cp tcs.tfvars.example tcs.tfvars
  terraform init -upgrade
  TF_VAR_image_tag="$IMAGE_TAG" terraform plan -var-file=tcs.tfvars -out=tcs.tfplan
}

tf_apply() {
  cd "$ROOT_DIR/infra/gcp/terraform"
  if [[ ! -f tcs.tfplan ]]; then
    err "no tcs.tfplan found — run ./golive.sh tf-plan first"
    exit 1
  fi
  terraform apply tcs.tfplan
  rm -f tcs.tfplan
}

dns() {
  "$(dirname "$0")/godaddy-dns.sh" apply
  log "verifying..."
  "$(dirname "$0")/godaddy-dns.sh" verify
}

monitoring() {
  "$ROOT_DIR/infra/observability/apply-monitoring.sh"
}

smoketest() {
  local gateway_url
  gateway_url="$(cd "$ROOT_DIR/infra/gcp/terraform" && terraform output -raw gateway_url)"
  log "gateway_url: $gateway_url"
  local key="${TCS_SMOKETEST_API_KEY:-}"
  if [[ -z "$key" ]]; then
    err "set TCS_SMOKETEST_API_KEY to a real gateway API key before running this"
    exit 1
  fi
  log "POST /v1/chat/completions with tcs-cheap (should route to DeepInfra if configured)"
  curl -sS "${gateway_url}/v1/chat/completions" \
    -H "Authorization: Bearer ${key}" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "tcs-cheap",
      "messages": [{"role":"user","content":"Reply with just OK."}],
      "max_tokens": 8
    }' | jq .
}

all() {
  preflight
  bootstrap
  secrets
  wif
  build_image
  tf_plan
  log "tf-plan complete — review above. Run ./golive.sh tf-apply to proceed."
}

case "${1:-}" in
  preflight) preflight ;;
  bootstrap) bootstrap ;;
  secrets) secrets ;;
  wif) wif ;;
  build) build_image ;;
  tf-plan) tf_plan ;;
  tf-apply) tf_apply ;;
  dns) dns ;;
  monitoring) monitoring ;;
  smoketest) smoketest ;;
  all) all ;;
  ""|-h|--help) sed -n '2,21p' "$0" ;;
  *) echo "unknown phase: $1" >&2; exit 1 ;;
esac
