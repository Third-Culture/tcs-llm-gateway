#!/usr/bin/env bash
# Sets up Workload Identity Federation so the GitHub Actions workflow in
# .github/workflows/tcs-deploy.yml can authenticate to GCP without a JSON
# service account key.
#
# Idempotent. Safe to re-run.
#
# Usage:
#   ./setup-wif.sh                             # creates pool, provider, deployer SA
#   ./setup-wif.sh --repo Third-Culture/tcs-llm-gateway   # override repo
#
# Requires: gcloud authenticated with IAM Owner (or at least roles/iam.admin)
# on the third-culture project.

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
REGION="${TCS_GCP_REGION:-us-central1}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"

POOL_ID="tcs-github-pool"
PROVIDER_ID="tcs-github-provider"
SA_NAME="tcs-llm-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
REPO="${1:-Third-Culture/tcs-llm-gateway}"

log() { printf "\033[1;34m[wif]\033[0m %s\n" "$*"; }

ensure_pool() {
  if "$GCLOUD" iam workload-identity-pools describe "$POOL_ID" \
      --location=global --project "$PROJECT" >/dev/null 2>&1; then
    log "Workload Identity pool $POOL_ID already exists"
    return
  fi
  log "Creating Workload Identity pool $POOL_ID"
  "$GCLOUD" iam workload-identity-pools create "$POOL_ID" \
    --location=global \
    --display-name="TCS GitHub Actions" \
    --project "$PROJECT"
}

ensure_provider() {
  if "$GCLOUD" iam workload-identity-pools providers describe "$PROVIDER_ID" \
      --workload-identity-pool="$POOL_ID" --location=global \
      --project "$PROJECT" >/dev/null 2>&1; then
    log "Workload Identity provider $PROVIDER_ID already exists"
    return
  fi
  log "Creating Workload Identity provider $PROVIDER_ID (repo: $REPO)"
  "$GCLOUD" iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository==\"${REPO}\"" \
    --project "$PROJECT"
}

ensure_sa() {
  if "$GCLOUD" iam service-accounts describe "$SA_EMAIL" \
      --project "$PROJECT" >/dev/null 2>&1; then
    log "Service account $SA_EMAIL already exists"
    return
  fi
  log "Creating service account $SA_EMAIL"
  "$GCLOUD" iam service-accounts create "$SA_NAME" \
    --display-name="TCS LLM Gateway Deployer" \
    --project "$PROJECT"
}

grant_sa_roles() {
  local roles=(
    roles/run.admin
    roles/artifactregistry.writer
    roles/iam.serviceAccountUser
    roles/storage.objectViewer
  )
  for role in "${roles[@]}"; do
    log "Granting $role to $SA_EMAIL"
    "$GCLOUD" projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:$SA_EMAIL" \
      --role="$role" \
      --condition=None \
      --quiet >/dev/null
  done
}

bind_wif_to_sa() {
  local project_number
  project_number="$("$GCLOUD" projects describe "$PROJECT" --format=value\(projectNumber\))"
  local principal="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${REPO}"
  log "Binding WIF principal $REPO -> $SA_EMAIL"
  "$GCLOUD" iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --role="roles/iam.workloadIdentityUser" \
    --member="$principal" \
    --project "$PROJECT" \
    --quiet >/dev/null
}

main() {
  ensure_pool
  ensure_provider
  ensure_sa
  grant_sa_roles
  bind_wif_to_sa
  log "WIF ready. Workflow env should reference:"
  log "  WIF_PROVIDER=projects/${PROJECT}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
  log "  DEPLOY_SA=${SA_EMAIL}"
}

main "$@"
