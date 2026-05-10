#!/usr/bin/env bash
# Creates / updates the TCS LLM Gateway log-based metrics + dashboard in
# the third-culture GCP project. Idempotent.
#
# Usage: ./apply-monitoring.sh
#
# Requires: gcloud authenticated with roles/logging.configWriter +
# roles/monitoring.editor on third-culture, and jq.

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { printf "\033[1;34m[observability]\033[0m %s\n" "$*"; }

apply_log_metric() {
  local metric_json="$1"
  local name
  name="$(echo "$metric_json" | jq -r '.name')"
  local tmp
  tmp="$(mktemp)"
  echo "$metric_json" > "$tmp"

  if "$GCLOUD" logging metrics describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    log "updating log metric $name"
    "$GCLOUD" logging metrics update "$name" \
      --config-from-file="$tmp" \
      --project "$PROJECT" >/dev/null
  else
    log "creating log metric $name"
    "$GCLOUD" logging metrics create "$name" \
      --config-from-file="$tmp" \
      --project "$PROJECT" >/dev/null
  fi
  rm -f "$tmp"
}

apply_all_log_metrics() {
  local metrics_file="$SCRIPT_DIR/log-metrics.json"
  local count
  count="$(jq '.metrics | length' "$metrics_file")"
  for i in $(seq 0 $((count - 1))); do
    metric="$(jq -c ".metrics[$i]" "$metrics_file")"
    apply_log_metric "$metric"
  done
}

apply_dashboard() {
  local dash_file="$SCRIPT_DIR/dashboard.json"
  local display
  display="$(jq -r '.displayName' "$dash_file")"

  # gcloud monitoring dashboards does not have an idempotent create-or-update,
  # so we look up an existing dashboard by displayName and update it, or
  # create a new one.
  local existing
  existing="$("$GCLOUD" monitoring dashboards list \
    --project "$PROJECT" \
    --filter="displayName=\"$display\"" \
    --format="value(name)" 2>/dev/null || true)"

  if [[ -n "$existing" ]]; then
    log "updating monitoring dashboard $display"
    "$GCLOUD" monitoring dashboards update "$existing" \
      --config-from-file="$dash_file" \
      --project "$PROJECT" >/dev/null
  else
    log "creating monitoring dashboard $display"
    "$GCLOUD" monitoring dashboards create \
      --config-from-file="$dash_file" \
      --project "$PROJECT" >/dev/null
  fi
}

main() {
  if ! command -v jq >/dev/null; then
    echo "jq is required." >&2; exit 1
  fi
  apply_all_log_metrics
  apply_dashboard
  log "done."
}

main "$@"
