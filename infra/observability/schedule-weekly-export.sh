#!/usr/bin/env bash
# One-time setup: wrap export-to-metabase.sh in a Cloud Run job and schedule
# it weekly via Cloud Scheduler.
#
# Prereqs:
#   - ./apply-monitoring.sh has been run at least once (secrets must exist).
#   - Two Secret Manager secrets populated with full Postgres URIs:
#       TCS_LLM_DATABASE_URL              (source, already created by terraform)
#       TCS_METABASE_DATABASE_URL         (destination warehouse)
#   - The unified tcs-llm-gateway image is already in Artifact Registry
#     (the image ships psql + bash, so we reuse it rather than build a second).
#
# Idempotent — re-running updates the job + schedule in place.

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
REGION="${TCS_GCP_REGION:-us-central1}"
AR_REPO="${TCS_ARTIFACT_REPO:-tcs}"
IMAGE_NAME="llm-gateway"
IMAGE_TAG="${TCS_EXPORT_IMAGE_TAG:-latest}"
JOB_NAME="tcs-llm-export-metabase"
SCHEDULER_JOB="${JOB_NAME}-weekly"
SCHEDULE="${TCS_EXPORT_SCHEDULE:-0 2 * * SUN}"       # Sunday 02:00 UTC
TIMEZONE="${TCS_EXPORT_TZ:-Etc/UTC}"
SA_EMAIL="tcs-llm-gateway@${PROJECT}.iam.gserviceaccount.com"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${IMAGE_NAME}:${IMAGE_TAG}"
# The script is baked into the image under /app once the Dockerfile COPYs it.
EXPORT_SCRIPT="/app/infra/observability/export-to-metabase.sh"

log() { printf "\033[1;34m[export-schedule]\033[0m %s\n" "$*"; }

ensure_destination_secret() {
  if "$GCLOUD" secrets describe TCS_METABASE_DATABASE_URL --project "$PROJECT" >/dev/null 2>&1; then
    return
  fi
  log "creating placeholder secret TCS_METABASE_DATABASE_URL (populate before first run)"
  "$GCLOUD" secrets create TCS_METABASE_DATABASE_URL \
    --replication-policy=automatic \
    --labels=service=tcs-llm-gateway \
    --project "$PROJECT"
  printf '' | "$GCLOUD" secrets versions add TCS_METABASE_DATABASE_URL --data-file=- --project "$PROJECT" >/dev/null
}

create_or_update_job() {
  local exists
  exists="$("$GCLOUD" run jobs describe "$JOB_NAME" --region "$REGION" --project "$PROJECT" --format='value(name)' 2>/dev/null || true)"

  local cmd
  if [[ -n "$exists" ]]; then
    cmd="update"
    log "updating Cloud Run job $JOB_NAME"
  else
    cmd="create"
    log "creating Cloud Run job $JOB_NAME"
  fi

  "$GCLOUD" run jobs "$cmd" "$JOB_NAME" \
    --region "$REGION" \
    --project "$PROJECT" \
    --image "$IMAGE" \
    --service-account "$SA_EMAIL" \
    --max-retries 1 \
    --task-timeout 900s \
    --command="/bin/bash" \
    --args="-c,${EXPORT_SCRIPT}" \
    --set-secrets "TCS_LLM_DATABASE_URL=TCS_LLM_DATABASE_URL:latest,TCS_METABASE_DATABASE_URL=TCS_METABASE_DATABASE_URL:latest"
}

create_or_update_schedule() {
  local project_number
  project_number="$("$GCLOUD" projects describe "$PROJECT" --format=value\(projectNumber\))"
  local job_uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${project_number}/jobs/${JOB_NAME}:run"

  local exists
  exists="$("$GCLOUD" scheduler jobs describe "$SCHEDULER_JOB" --location "$REGION" --project "$PROJECT" --format='value(name)' 2>/dev/null || true)"

  local cmd
  if [[ -n "$exists" ]]; then
    cmd="update"
    log "updating scheduler $SCHEDULER_JOB ($SCHEDULE $TIMEZONE)"
    "$GCLOUD" scheduler jobs "$cmd" http "$SCHEDULER_JOB" \
      --project "$PROJECT" \
      --location "$REGION" \
      --schedule="$SCHEDULE" \
      --time-zone="$TIMEZONE" \
      --http-method POST \
      --uri="$job_uri" \
      --oauth-service-account-email "$SA_EMAIL"
  else
    cmd="create"
    log "creating scheduler $SCHEDULER_JOB ($SCHEDULE $TIMEZONE)"
    "$GCLOUD" scheduler jobs "$cmd" http "$SCHEDULER_JOB" \
      --project "$PROJECT" \
      --location "$REGION" \
      --schedule="$SCHEDULE" \
      --time-zone="$TIMEZONE" \
      --http-method POST \
      --uri="$job_uri" \
      --oauth-service-account-email "$SA_EMAIL"
  fi
}

grant_sa_cloud_run_invoker() {
  "$GCLOUD" projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/run.invoker" \
    --condition=None \
    --quiet >/dev/null
}

main() {
  ensure_destination_secret
  create_or_update_job
  grant_sa_cloud_run_invoker
  create_or_update_schedule
  log "done. First run happens at the next scheduled time."
  log "trigger manually:  gcloud run jobs execute $JOB_NAME --region $REGION --project $PROJECT"
}

main "$@"
