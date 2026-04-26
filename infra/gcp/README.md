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

| Service | Image                          | Public? | Notes                                                          |
| ------- | ------------------------------ | ------- | -------------------------------------------------------------- |
| gateway | `theopenco/llmgateway-gateway` | yes     | LLM routing entrypoint. Must be reachable from Greshi/clients. |
| api     | `theopenco/llmgateway-api`     | yes     | Management API for keys, projects, billing.                    |
| worker  | `theopenco/llmgateway-worker`  | no      | Pulls log + billing jobs from Redis. Must be always-on.        |
| ui      | `theopenco/llmgateway-ui`      | yes     | Dashboard. Optional in staging.                                |
| docs    | `theopenco/llmgateway-docs`    | yes     | Optional.                                                      |

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

- [`cloudrun-llmgateway-multicontainer.yaml`](./cloudrun-llmgateway-multicontainer.yaml)
  — single Cloud Run service that runs `gateway`, `worker`, and
  `redis` side-by-side. Inter-container traffic stays on `localhost`,
  Postgres lives in Cloud SQL. This is the manifest currently deployed
  in `williams-452112` for the Greshi integration.
- [`cloudrun-gateway.yaml`](./cloudrun-gateway.yaml) — gateway-only
  reference (kept for environments that prefer split services).
- [`cloudrun-api.yaml`](./cloudrun-api.yaml)
- [`cloudrun-worker.yaml`](./cloudrun-worker.yaml)

The gateway container is configured for streaming responses (long
request timeouts, `cpu-throttling: false`, and `minScale: 1` to avoid
cold-start penalties on the routing path). The worker container runs
inside the same instance via `container-dependencies`, so log /
billing draining stays continuous as long as the service has at least
one warm instance.

### One-shot production seed

After applying migrations against Cloud SQL (`pnpm --filter db migrate`
with `DATABASE_URL` pointing at the Cloud SQL instance), seed the
minimum entities the gateway needs to authenticate a self-hosted
client (one installation, one enterprise org, one project, one API
key):

```bash
SEED_GATEWAY_API_KEY=$(openssl rand -hex 24) \
DATABASE_URL=postgres://llmgateway_app:...@<cloud-sql-ip>:5432/llmgateway \
node packages/db/dist/seed-prod.js
```

Store the generated `SEED_GATEWAY_API_KEY` in Secret Manager (we use
`llmgateway-greshi-api-key`) and reference it from the consuming
service's deployment manifest.

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

## Production deployment in `williams-452112`

A live deployment of the LLM Gateway platform runs in the
`williams-452112` GCP project (us-central1). It is the upstream for the
Greshi `company_refresh` workflow and the long-term landing place for
every other internal service that needs cost-aware LLM routing.

The full platform is split across five Cloud Run services that are
self-contained (every dependency outside of Cloud SQL Postgres lives
inside the same Cloud Run service via container sidecars):

| Service      | URL                                                 | Manifest                                                                             | Notes                                             |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `llmgateway` | https://llmgateway-231857096432.us-central1.run.app | [cloudrun-llmgateway-multicontainer.yaml](./cloudrun-llmgateway-multicontainer.yaml) | gateway + worker + redis sidecars                 |
| `api`        | https://api-231857096432.us-central1.run.app        | [cloudrun-api-multicontainer.yaml](./cloudrun-api-multicontainer.yaml)               | management API + redis sidecar                    |
| `ui`         | https://ui-231857096432.us-central1.run.app         | [cloudrun-ui-deployed.yaml](./cloudrun-ui-deployed.yaml)                             | Next.js dashboard (server-side talks to `api`)    |
| `playground` | https://playground-231857096432.us-central1.run.app | [cloudrun-playground-deployed.yaml](./cloudrun-playground-deployed.yaml)             | Next.js playground (server-side talks to gateway) |
| `docs`       | https://docs-231857096432.us-central1.run.app       | [cloudrun-docs-deployed.yaml](./cloudrun-docs-deployed.yaml)                         | Fumadocs static site                              |

All five are publicly invokable. `llmgateway` and `api` are the
authenticated entrypoints; `ui`, `playground`, and `docs` are
unauthenticated front-ends that delegate auth to `api`.

Shared backing infrastructure:

- **Database**: Cloud SQL Postgres 15 instance `llmgateway-pg`
  (db-f1-micro, public IP, schema applied via `pnpm --filter db
migrate`). Same instance is reused by both `llmgateway` and `api`.
- **Cache**: Redis 7-alpine sidecars co-located in `llmgateway` and
  `api`. Inter-container traffic stays on `localhost`, no Memorystore
  required.
- **Secrets**: `llmgateway-auth-secret`, `llmgateway-api-key-hash-secret`,
  `llmgateway-database-url`, `llmgateway-db-app-password`, and
  `llmgateway-greshi-api-key`, all in Secret Manager.

### Auth + cookies on `*.run.app`

`*.run.app` is on the public suffix list, so the API cannot set an
explicit `Domain` attribute on its session cookie. The runtime config
in `apps/api/src/auth/config.ts` therefore:

1. Treats `COOKIE_DOMAIN` as optional. If unset, host-only cookies are
   used (this is what the deployed `api` service does — see the
   manifest, which sets `COOKIE_DOMAIN: ""`).
2. Forces `SameSite=None; Secure` whenever the cookie is host-only and
   the API is served over HTTPS, so cross-origin requests from
   `ui-231857096432.us-central1.run.app` to
   `api-231857096432.us-central1.run.app` carry the auth cookie.

Verify after a deploy by signing up against the API and checking the
`Set-Cookie` header:

```bash
curl -i -H "Origin: https://ui-231857096432.us-central1.run.app" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"email":"smoke@example.com","password":"long-test-password","name":"smoke"}' \
  https://api-231857096432.us-central1.run.app/auth/sign-up/email \
  | grep -i "set-cookie"
# Expect: __Secure-better-auth.session_token=...; SameSite=None; Secure; ...
```

### Deploying the platform

The reference manifests use `REPLACE_*` placeholders to keep secrets and
project-specific values out of git. Render and apply with:

```bash
PROJECT=williams-452112
REGION=us-central1
SA=github-actions
REGISTRY=us-central1-docker.pkg.dev
REPO=greshi-repo
TAG=$(git rev-parse --short=8 HEAD)
GATEWAY_URL=https://llmgateway-231857096432.us-central1.run.app
API_URL=https://api-231857096432.us-central1.run.app
UI_URL=https://ui-231857096432.us-central1.run.app
PLAYGROUND_URL=https://playground-231857096432.us-central1.run.app
DOCS_URL=https://docs-231857096432.us-central1.run.app
ORIGIN_URLS="$UI_URL,$PLAYGROUND_URL,$DOCS_URL,$GATEWAY_URL"

for tpl in cloudrun-api-multicontainer.yaml \
           cloudrun-ui-deployed.yaml \
           cloudrun-playground-deployed.yaml \
           cloudrun-docs-deployed.yaml; do
  sed \
    -e "s|REPLACE_PROJECT|$PROJECT|g" \
    -e "s|REPLACE_REGION|$REGION|g" \
    -e "s|REPLACE_SA|$SA|g" \
    -e "s|REPLACE_REGISTRY|$REGISTRY|g" \
    -e "s|REPLACE_REPO|$REPO|g" \
    -e "s|REPLACE_TAG|$TAG|g" \
    -e "s|REPLACE_SQL_INSTANCE|llmgateway-pg|g" \
    -e "s|REPLACE_GATEWAY_URL_V1|$GATEWAY_URL/v1|g" \
    -e "s|REPLACE_GATEWAY_URL|$GATEWAY_URL|g" \
    -e "s|REPLACE_API_URL|$API_URL|g" \
    -e "s|REPLACE_UI_URL|$UI_URL|g" \
    -e "s|REPLACE_PLAYGROUND_URL|$PLAYGROUND_URL|g" \
    -e "s|REPLACE_DOCS_URL|$DOCS_URL|g" \
    -e "s|REPLACE_ORIGIN_URLS|$ORIGIN_URLS|g" \
    infra/gcp/$tpl > /tmp/llmgw-deploy/$tpl
  gcloud run services replace /tmp/llmgw-deploy/$tpl \
    --region=$REGION --project=$PROJECT
done
```

`llmgateway` (the routing service) keeps its own image and manifest;
the snippet above only handles the four "platform" services that were
added on top of it.

### Greshi env wiring

Greshi (the canonical first internal consumer) is wired with:

- `LLM_GATEWAY_BASE_URL=https://llmgateway-231857096432.us-central1.run.app`
- `LLM_GATEWAY_API_KEY` ← secret `llmgateway-greshi-api-key:latest`
- `LLM_GATEWAY_MODEL=auto`

The `greshi-backend` runtime SA
(`231857096432-compute@developer.gserviceaccount.com`) holds
`roles/secretmanager.secretAccessor` on `llmgateway-greshi-api-key`.

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
