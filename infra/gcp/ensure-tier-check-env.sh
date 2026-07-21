#!/usr/bin/env bash
# Ensure the worker has the TCS tier routing health-check env vars set.
# The loop only runs when TCS_TIER_CHECK_ENABLED=true (hourly by default).
#
# Usage:
#   ./ensure-tier-check-env.sh

set -euo pipefail

PROJECT="${TCS_GCP_PROJECT:-third-culture}"
REGION="${TCS_GCP_REGION:-us-central1}"
GCLOUD="${GCLOUD_BIN:-/Users/di/google-cloud-sdk/bin/gcloud}"
GATEWAY_URL="${TCS_TIER_CHECK_GATEWAY_URL:-https://llmgateway-gateway-qm3fwjoi5q-uc.a.run.app}"
ALERT_EMAILS="${TCS_TIER_CHECK_ALERT_EMAILS:-di@thirdculture.world}"
API_KEY_SECRET="${TCS_TIER_CHECK_API_KEY_SECRET:-llm-gateway-api-key}"

log() { printf "\033[1;34m[tier-check]\033[0m %s\n" "$*"; }

log "updating llmgateway-worker tier-check env"
"$GCLOUD" run services update llmgateway-worker \
	--project="$PROJECT" \
	--region="$REGION" \
	--update-env-vars="TCS_TIER_CHECK_ENABLED=true,TCS_TIER_CHECK_INTERVAL_SECONDS=3600,TCS_TIER_CHECK_GATEWAY_URL=${GATEWAY_URL},TCS_TIER_CHECK_ALERT_EMAILS=${ALERT_EMAILS}" \
	--update-secrets="TCS_TIER_CHECK_API_KEY=${API_KEY_SECRET}:latest" \
	--quiet

log "done — worker will probe every hour when enabled"
