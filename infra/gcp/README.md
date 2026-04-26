# Self-hosted GCP deployment

This document describes how Third Culture runs the LLM Gateway on its own
Google Cloud project. It covers the runtime topology, required services,
secret management, health checks, observability, and a deterministic
smoke test that proves a deployment is healthy end-to-end.

The repository ships two deploy paths:

- **Helm on GKE** (`infra/helm/llmgateway/`). Recommended for production.
- **Cloud Run** (this directory). Useful for staging, isolated dev
  projects, or workloads that do not justify a full GKE cluster.

Pick one path per environment. Do not mix them within a single
environment because secrets and config are environment-specific.

## Topology

Each environment runs the following services:

| Service | Image                       | Public? | Notes                                                         |
| ------- | --------------------------- | ------- | ------------------------------------------------------------- |
| gateway | `theopenco/llmgateway-gateway` | yes  | LLM routing entrypoint. Must be reachable from Greshi/clients. |
| api     | `theopenco/llmgateway-api`     | yes  | Management API for keys, projects, billing.                   |
| worker  | `theopenco/llmgateway-worker`  | no   | Pulls log + billing jobs from Redis. Must be always-on.       |
| ui      | `theopenco/llmgateway-ui`      | yes  | Dashboard. Optional in staging.                               |
| docs    | `theopenco/llmgateway-docs`    | yes  | Optional.                                                     |

Backing services per environment:

- Cloud SQL Postgres 17 (primary, regional). Connect via the Cloud SQL
  Auth Proxy or private IP.
- Memorystore Redis 7 (basic tier is fine for staging; standard tier
  with HA in prod).
- Secret Manager for every secret listed in `secrets.example.env`.
- Artifact Registry hosting per-service container images.
- Cloud Logging for stdout from each service.
- Cloud Monitoring + Managed Prometheus for the gateway's `/metrics`
  endpoint.

## Environments

We run three environments. Each is its own GCP project to keep IAM,
quota, and incident blast radius small:

- `tcs-llm-gateway-dev` — local-style development.
- `tcs-llm-gateway-staging` — pre-prod, used for the Greshi smoke test.
- `tcs-llm-gateway-prod` — production.

Database, Redis, secrets, and Artifact Registry repos are duplicated
per project. Service accounts are also per-project; no service account
is shared across environments.

## Required secrets

All secrets live in Secret Manager. The runtime services receive them
via Cloud Run / GKE secret references — never as plain env vars in
service definitions, never committed to git.

See [`secrets.example.env`](./secrets.example.env) for the full list.
The non-negotiable ones for every environment are:

- `AUTH_SECRET` — 32+ chars, used by Better Auth.
- `GATEWAY_API_KEY_HASH_SECRET` — HMAC secret for hashing gateway API
  keys at rest. Rotating this invalidates every gateway key.
- `DATABASE_URL` — Cloud SQL Postgres URL (private IP preferred).
- `REDIS_URL` — Memorystore Redis URL.

Provider keys are optional — only set the ones whose models you want
the gateway to be able to use as fallback when projects do not bring
their own keys. Format: `LLM_<PROVIDER>_API_KEY` (see Helm
`values.yaml > llmProviders`).

## Cloud Run reference manifests

Apply with `gcloud run services replace <file> --region=<region>` after
substituting environment-specific image digests, secret names, and the
project's Cloud SQL connection name.

- [`cloudrun-gateway.yaml`](./cloudrun-gateway.yaml)
- [`cloudrun-api.yaml`](./cloudrun-api.yaml)
- [`cloudrun-worker.yaml`](./cloudrun-worker.yaml)

The gateway service is configured for streaming responses (long
request timeouts and a min instance count of 1 to avoid cold-start
penalties on the routing path). The worker uses min instances ≥ 1 so
log/billing draining is continuous.

## Health checks

Every service exposes a Hono `/` route that performs liveness +
readiness checks. Configure platform health checks against `GET /` on
each service:

- 200 with `{ "health": { "status": "ok", ... } }` → healthy.
- 503 with `{ "health": { "status": "degraded", ... } }` → unhealthy;
  platform should restart / drain.

Gateway-specific environment toggles (already wired in `apps/gateway/src/app.ts`):

- `HEALTH_CHECK_SKIP_DATABASE=false` to include the DB check (default
  skips DB because the gateway can serve cached IAM rules from Redis).
- `HEALTH_CHECK_TIMEOUT_MS=15000`.

## Observability

The repo already emits OpenTelemetry traces and Prometheus metrics. To
collect them on GCP:

- **Logs**: Cloud Run / GKE stdout → Cloud Logging by default. Add a
  log-based metric for `severity>=ERROR` to alert on error rate.
- **Traces**: set `OTEL_SERVICE_NAME=<service>-<env>` and either
  `OTEL_EXPORTER_OTLP_ENDPOINT=https://cloudtrace.googleapis.com/v2`
  with the Google managed OTel collector, or run a sidecar collector.
- **Metrics**: scrape `gateway.<host>/metrics` with Managed Prometheus.
  The dashboards we care about:
  - request latency (p50/p95/p99) per task profile.
  - cost per request, broken down by provider and model.
  - routing-decision counters (`auto-selected`, `task-profile`,
    `fallback-used`).
  - provider 5xx rate.
- **Alerts** (minimum viable):
  - p95 gateway latency > 5s for 5m.
  - error rate > 2% over 5m.
  - any worker crash-loop.
  - Cloud SQL CPU > 80% sustained.
  - Memorystore connection failures > 0 for 1m.

## Smoke test

Run [`smoke-test.sh`](./smoke-test.sh) after every deploy:

```bash
GATEWAY_URL="https://gateway-staging.thirdculture.world" \
GATEWAY_API_KEY="<staging-key>" \
./infra/gcp/smoke-test.sh
```

The script asserts:

1. `GET /` → 200 and `health.status == "ok"`.
2. `POST /v1/chat/completions` with `model: "auto"` and a JSON task
   profile returns a parseable JSON object and a billable cost.
3. Routing metadata in the response or in the gateway logs records the
   selected model, provider, and reason.

A non-zero exit means the smoke test failed; the deploy should be
rolled back or held back from promotion.

## Greshi staging integration

The Greshi backend (`/Users/di/Desktop/greshi`) speaks to the gateway
via the OpenAI Python client. Configure these env vars on the Greshi
service in staging:

```
LLM_GATEWAY_BASE_URL=https://gateway-staging.thirdculture.world
LLM_GATEWAY_API_KEY=<staging-key>
LLM_GATEWAY_MODEL=auto
```

When `LLM_GATEWAY_API_KEY` is unset the Greshi adapter falls back to
direct Gemini, so partial rollouts (e.g. switching one workflow at a
time) are safe.

## Promotion checklist

Before promoting a deploy from staging → prod:

1. `pnpm test:unit` green in CI.
2. `pnpm test:e2e` (gateway routing subset) green in CI.
3. `infra/gcp/smoke-test.sh` against staging exits 0.
4. Greshi pytest suite (`tests/unit/backend/test_llm_gateway.py` and
   `tests/integration/test_llm_gateway_integration.py`) green.
5. One real Greshi company refresh end-to-end against the staging
   gateway, verified in Salesforce.
6. New gateway version pinned by image digest, not tag.
