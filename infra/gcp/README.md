# Self-hosted GCP deployment

This document describes how Third Culture runs the LLM Gateway on its own
Google Cloud project. It covers the runtime topology, required services,
secret management, health checks, observability, and a deterministic
smoke test that proves a deployment is healthy end-to-end.

**CI/CD**: the live `third-culture` deployment ships via
[`.github/workflows/deploy-gcp.yml`](../../.github/workflows/deploy-gcp.yml)
on every push to `main`. See "Deploying the platform" below — do not
`docker push` / `gcloud run deploy` by hand.

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

There is currently one live environment, running in the `third-culture`
GCP project (`us-central1`). There is no separate dev/staging/prod
project split today — the sections below describing multiple projects
and a staging domain are aspirational/legacy and do not reflect what
is actually deployed. See "Production deployment in `third-culture`"
for the verified, current state.

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
  Postgres lives in Cloud SQL. This manifest is a reference only — it
  is not what is currently deployed (see "Production deployment in
  `third-culture`" below for the live setup, which is Terraform-managed
  and split into separate `ui` / `api` / `gateway` services instead).
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

Store the generated `SEED_GATEWAY_API_KEY` in Secret Manager (in the
live `third-culture` deployment, consumer keys are named
`tcs-llm-key-<consumer>`) and reference it from the consuming
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

Run [`smoke-test.sh`](./smoke-test.sh) after every deploy, against the
real gateway URL (see "Production deployment in `third-culture`"
below — there is no separate staging domain):

```bash
GATEWAY_URL="https://llmgateway-gateway-303980490211.us-central1.run.app" \
GATEWAY_API_KEY="<a tcs-llm-key-* key>" \
./infra/gcp/smoke-test.sh
```

The script asserts:

1. `GET /` → 200 and `health.status == "ok"`.
2. `POST /v1/chat/completions` with `model: "auto"` and a JSON task
   profile returns a parseable JSON object and a billable cost.
3. Routing metadata in the response or in the gateway logs records the
   selected model, provider, and reason.

A non-zero exit means the smoke test failed; the deploy should be
rolled back.

## Production deployment in `third-culture`

_Verified directly against live GCP resources on 2026-07-02 — trust
this section, not any older references to `williams-452112` elsewhere
in this repo's history, which described a deployment that does not
actually exist._

The live LLM Gateway platform runs in the `third-culture` GCP project
(`us-central1`), provisioned by Terraform (not tracked in this repo —
`goog-terraform-provisioned: true` on every service, so do not manage
these services by hand with `gcloud run services replace` without
syncing back to the Terraform source of truth). It is a single
environment; there is no separate staging/dev deployment today.

| Service              | URL                                                         | Port | Scaling (min/max) | Notes                                                           |
| -------------------- | ----------------------------------------------------------- | ---- | ----------------- | --------------------------------------------------------------- |
| `llmgateway-ui`      | https://llmgateway-ui-303980490211.us-central1.run.app      | 3002 | 0 / 3             | Next.js dashboard (our UI)                                      |
| `llmgateway-api`     | https://llmgateway-api-303980490211.us-central1.run.app     | 4002 | 1 / 5             | Management API, runs migrations on boot (`RUN_MIGRATIONS=true`) |
| `llmgateway-gateway` | https://llmgateway-gateway-303980490211.us-central1.run.app | 4001 | 1 / 10            | LLM routing entrypoint                                          |

There is no `playground` or `docs` Cloud Run service deployed for this
project. No custom domain is mapped to any of the three services —
they are only reachable on their default `*.run.app` URLs.

All three services run from the same container image
(`us-central1-docker.pkg.dev/third-culture/tcs/llm-gateway`, pinned by
digest) under the `tcs-llm-gateway@third-culture.iam.gserviceaccount.com`
runtime service account, attached to the `tcs-llm-connector` VPC
connector (`private-ranges-only` egress) so they can reach private
backing services.

**Deploy identity** (used by `deploy-gcp.yml`, not the runtime identity
above): GitHub Actions authenticates as
`tcs-llm-deployer@third-culture.iam.gserviceaccount.com` via Workload
Identity Federation — no long-lived key. The trust chain:

- WIF pool/provider:
  `projects/303980490211/locations/global/workloadIdentityPools/tcs-github-pool/providers/tcs-github-provider`,
  scoped to only accept tokens where
  `assertion.repository=="Third-Culture/tcs-llm-gateway"`.
- `tcs-llm-deployer` trusts that provider via `roles/iam.workloadIdentityUser`
  and holds exactly `roles/artifactregistry.writer`, `roles/run.admin`, and
  `roles/iam.serviceAccountUser` at the project level — enough to push
  images and deploy Cloud Run, nothing more.
- The provider resource name above is stored as the `WIF_PROVIDER` repo
  secret (not sensitive on its own, but kept out of the workflow file for
  easy rotation if the pool is ever recreated).

Shared backing infrastructure:

- **Database**: Cloud SQL Postgres 16 instance `tcs-llm-postgres`
  (db-g1-small, private IP only, `10.28.1.3`). Reused by `llmgateway-api`
  and `llmgateway-gateway`.
- **Cache**: Redis reachable at `10.28.0.3:6379` over the VPC
  connector (not a sidecar).
- **Secrets** (Secret Manager, referenced by the services above):
  `TCS_LLM_AUTH_SECRET`, `GATEWAY_API_KEY_HASH_SECRET`,
  `TCS_LLM_DATABASE_URL`, `TCS_LLM_INTERNAL_STATS_TOKEN`,
  `TCS_LLM_REDIS_PASSWORD`, `LLM_GOOGLE_AI_STUDIO_API_KEY`,
  `LLM_DEEPINFRA_API_KEY`, `LLM_WANDB_API_KEY`, `TCS_LINEAR_API_KEY`,
  `TCS_LINEAR_BUDGET_TEAM_ID`, `TCS_SLACK_BUDGET_WEBHOOK_URL`.
- **Consumers**: internal gateway API keys exist per consumer —
  `tcs-llm-key-dev-shared`, `tcs-llm-key-salesforce-digify-sync`,
  `tcs-llm-key-tcs-linear-automations`, `tcs-llm-key-tcs-metabase`,
  `tcs-llm-key-tcs-williams-services` (Secret Manager, `third-culture`
  project). Note: Greshi (`greshi-backend` in `williams-452112`) is
  **not** currently wired to this gateway — it calls Gemini directly
  via `GEMINI_API_KEY`, despite older docs in this file describing a
  planned Greshi integration.

### Auth + cookies on `*.run.app`

`*.run.app` is on the public suffix list, so the API cannot set an
explicit `Domain` attribute on its session cookie. The runtime config
in `apps/api/src/auth/config.ts` therefore:

1. Treats `COOKIE_DOMAIN` as optional. The deployed `llmgateway-api`
   sets it to `llmgateway-api-303980490211.us-central1.run.app`
   (host-only for that domain).
2. Forces `SameSite=None; Secure` whenever the cookie is host-only and
   the API is served over HTTPS, so cross-origin requests from
   `llmgateway-ui-303980490211.us-central1.run.app` to
   `llmgateway-api-303980490211.us-central1.run.app` carry the auth
   cookie.

Verify after a deploy by signing up against the API and checking the
`Set-Cookie` header:

```bash
curl -i -H "Origin: https://llmgateway-ui-303980490211.us-central1.run.app" \
  -H "Content-Type: application/json" \
  -X POST \
  -d '{"email":"smoke@example.com","password":"long-test-password","name":"smoke"}' \
  https://llmgateway-api-303980490211.us-central1.run.app/auth/sign-up/email \
  | grep -i "set-cookie"
# Expect: __Secure-better-auth.session_token=...; SameSite=None; Secure; ...
```

### Deploying the platform

**Push to `main`.** [`.github/workflows/deploy-gcp.yml`](../../.github/workflows/deploy-gcp.yml)
runs the full test suite, then builds three separate per-service images
from `infra/split.dockerfile` (`api`, `gateway`, `ui` targets — the same
lightweight images each service already runs) and deploys each one to its
matching Cloud Run service by digest. You can also re-run it manually from
the Actions tab (`workflow_dispatch`) to redeploy the current `main`
without a new commit, which is the fastest way to "roll back" — re-run the
workflow from a prior commit.

Do not switch this pipeline to `infra/unified.dockerfile` for these three
services: that image boots a local Postgres/Redis and starts every app —
including the worker — inside a single container via `supervisord`. Since
`api`/`gateway`/`ui` autoscale independently (up to 5/10/3 instances),
that would run multiple duplicate, uncoordinated worker processes against
the same production Redis queue, and the extra local services would
compete for the 1 CPU / 2Gi memory already budgeted per instance.

Do not `docker push` / `gcloud run deploy` by hand, and do not apply the
`cloudrun-*.yaml` reference manifests in this directory against
`third-culture` — they describe a different (sidecar-based) topology than
what's actually running and will drift from both the workflow and the
Terraform state.

Everything about these services _except_ the image reference (scaling,
secrets, networking, IAM) is Terraform-managed outside this repo. That
Terraform config isn't updated by `deploy-gcp.yml`, so whoever owns it
should make sure it either doesn't manage the `image` field on these
`google_cloud_run_v2_service` resources, or sets a
`lifecycle { ignore_changes = [template[0].containers[0].image] }` block
on it — otherwise a future `terraform apply` could revert a deploy back to
an old image. This is a known gap; flag it if you touch that config.

To inspect current live config:

```bash
gcloud run services describe llmgateway-gateway \
  --project=third-culture --region=us-central1
```

## Checklist before shipping a change

1. `pnpm test:unit` and `pnpm build` pass locally (also re-run by
   `deploy-gcp.yml` before it deploys, but faster to catch here).
2. `pnpm test:e2e` (gateway routing subset) green, if the change touches
   routing.
3. Merge/push to `main` — `deploy-gcp.yml` builds, pushes (pinned by
   digest), and deploys automatically. Watch the run in the Actions tab.
4. Optionally run `infra/gcp/smoke-test.sh` against the live gateway URL
   for a deeper check than the workflow's built-in health-check step.
