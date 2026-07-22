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

### The recurring `log_error` alert (root cause, 2026-07-14)

The `llmgateway-gateway` `log_error` alert kept re-firing across revisions
(`00038-clb`, `00040-bdf`, `00046-rxq`, ...). Five prior autofix PRs (#4, #7,
#8, #10, #12) all took the same approach — downgrade `logger.error` →
`logger.warn` on request-path operational logs — and the alert kept coming
back. That is the tell that the cosmetic fixes were never touching the real
trigger.

**What was ruled out.** The running revision is healthy: `GET /` returns
`health.status: ok` and the deploy's real completion smoke test passes
(`tcs-reasoning` → `deepinfra/deepinfra-kimi-k2.6`, tokens + billable cost
reported). The one CI verify failure on `b5782df` was a Secret Manager
permission gap (`tcs-llm-deployer` lacked `secretmanager.versions.access`),
fixed in `9b8cf15` by using a masked Actions secret — not an application error.
After the prior PRs, the only `severity>=ERROR` logs left anywhere in the
gateway's runtime import graph are the legitimate global handlers in
`apps/gateway/src/app.ts` (HTTP 500 / unhandled) and `apps/gateway/src/serve.ts`
(fatal startup/shutdown). Those are correct and must **not** be downgraded —
doing so would hide real outages.

**Actual root cause — telemetry flush on teardown.** `shutdownInstrumentation`
(`packages/instrumentation/src/index.ts`) logged an OpenTelemetry shutdown
failure at `warn` (PR #12) but then **re-threw** it. Every service's
`gracefulShutdown` (`apps/*/src/serve.ts`) awaits it inside the try whose catch
does `logger.error("Error during graceful shutdown")` — severity=ERROR. On
Cloud Run, every revision rollout and every scale-in sends `SIGTERM` to the
outgoing instance; the Cloud Trace (gRPC) span flush frequently times out
inside the short termination grace, so `sdk.shutdown()` rejects → re-throw →
`logger.error` → the raw `severity>=ERROR` log-based metric trips. Because the
gateway runs `minScale 1 / maxScale 10` and every merge to `main` (including the
autofix merges themselves) creates a new revision, this fired on essentially
every deploy/teardown, independent of the code in that revision — which is
exactly the observed "recurs on every revision" pattern. The HTTP server, DB,
and Redis are all closed cleanly _before_ this point, so dropping a few trace
spans on teardown is not an outage.

**Fix.** Stop re-throwing the best-effort span-flush failure from
`shutdownInstrumentation` (it is still logged at `warn`). Genuine shutdown
failures (HTTP server / DB / Redis close) remain the only things that escalate
to `logger.error`, so real failures are still alerted. Regression tests live in
`packages/instrumentation/src/index.spec.ts`. This fixes `gateway`, `api`, and
`worker`, which shared the identical shutdown path.

**Recommended monitoring follow-ups (Terraform, outside this repo).** The alert
policy is a raw `severity>=ERROR` log metric with no rate/duration threshold, so
a single legitimate ERROR entry pages. Prefer alerting on the gateway's HTTP 5xx
response-count metric (Cloud Run request metrics or the `/metrics` counters),
add a sustained rate/duration threshold, and exclude expected lifecycle logs.
Also stop auto-merging cosmetic autofix PRs for this alert — each merge is a new
revision that re-tests and can re-trip it.

**Latent risk noted (not the trigger).** `apps/gateway/src/responses/responses.ts`
hard-imports `zstdDecompress` from `node:zlib` (added in Node 22.15). Production
runs Node 24.13.0 (`.tool-versions`) so it is fine today, but pinning Node
< 22.15 anywhere would crash the whole gateway at module load. Keep
`.tool-versions` at Node ≥ 24 (or make that import lazy/guarded).

### The recurrence (root cause, 2026-07-21) — upstream 503, not code

The `llmgateway-gateway` `log_error` alert paged again after #10/#12 (and the
later #13/#17). Rather than ship an eighth cosmetic log-level patch, the trigger
was traced to a specific, confirmed source.

**Confirmed root cause (external dependency, not a gateway bug).** Per the repo
owner's Cloud Logging investigation recorded when closing
[#19](https://github.com/Third-Culture/tcs-llm-gateway/pull/19):

> The paging entries were Cloud Run **platform request logs** for HTTP 500 when
> **Google AI Studio returned 503** and callers pinned `google-ai-studio/tcs-cheap`
> (**no fallback**). Not an application ERROR path, so further gateway code
> changes are not the fix.

**Independent code verification of that path** (so the finding is grounded, not
just trusted):

- A caller pinning a single provider/model (or sending `x-no-fallback`) makes
  `shouldRetryRequest` (`apps/gateway/src/chat/tools/retry-with-fallback.ts`)
  return `false`, so the upstream failure is surfaced directly with no waterfall.
- The non-streaming terminal error path
  (`apps/gateway/src/chat/chat.ts`, ~L8814) computes the client status as
  `finishReason === "upstream_error" && res.status === 429 ? 429 : 500`. An
  upstream **503 ≠ 429 → client HTTP 500**.
- Cloud Run's platform request logging marks any 5xx as `severity>=ERROR`, which
  trips the raw `severity>=ERROR` log-based metric (the over-sensitive policy
  already flagged on 2026-07-14 above).

**Where it was actually fixed (outside this repo).** `tcs-monitoring`
**#36 / TCS-1154**: a monitoring filter exclusion for these provider-driven 5xx
request logs, plus using the bare `tcs-cheap` alias (which retains fallback) for
the monitoring bridge instead of the pinned `google-ai-studio/tcs-cheap`.

**Why no gateway code change is warranted.** This is an external dependency
outage (Google AI Studio 503) reaching a deliberately no-fallback pinned route.
Downgrading/swallowing this path would hide a real upstream outage; and remapping
`500 → 502/503` would **not** clear the alert anyway (Cloud Run still classifies
every 5xx request log as `severity>=ERROR`) — it would be another cosmetic change,
not a fix. So no log severity was lowered, no exception swallowed, no monitor
weakened, and no handler changed.

**Regression guard added.** `apps/gateway/src/log-severity.spec.ts` gained an
_inverse_ check ("genuine failure handlers still escalate to ERROR/CRITICAL"):
the existing two checks keep operational noise out of ERROR, and this new one
fails if any real failure handler (`app.ts` HTTP 500 / unhandled;
`serve.ts` fatal startup + graceful-shutdown + `logger.fatal` crash paths) is
downgraded to quiet the alert. This locks out the exact anti-pattern that
produced 7+ cosmetic PRs while keeping real outages paging.

**Verification checklist (for anyone with Cloud Logging access).** Confirm the
paging entries are external-503 request logs, not a fresh app crash:

```bash
# Are the ERROR entries platform request logs (5xx), i.e. httpRequest present?
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="llmgateway-gateway"
   severity>=ERROR' \
  --project=third-culture --freshness=7d --limit=50 \
  --format='table(timestamp, httpRequest.status, httpRequest.requestUrl, jsonPayload.message)'

# If httpRequest.status is 500 and jsonPayload.message is empty → platform request
# log for a 5xx (external/upstream), matching this root cause. If instead you see
# jsonPayload.message == "HTTP 500 exception" or "Unhandled error" on a real
# request path (not teardown), that is a genuinely different code bug and warrants
# a targeted, #18-style input-validation fix — not a log downgrade.
```

### The `llmgateway-ui` `log_error` alert (root cause, 2026-07-21) — bad third-party data, not a transient failure

Unlike the gateway's alert (an intermittent upstream 503), this one is
**deterministic**: it fires on essentially every request to `/`, `/login`,
`/signup`, and `/enterprise` — the highest-traffic pages in the app.

**Root cause.** `Testimonials` (`src/components/landing/testimonials.tsx`) and
`AuthBrandPanel` (`src/components/auth/auth-brand-panel.tsx`) render real
tweets via `TweetCard` → `MagicTweet` → `react-tweet`'s `enrichTweet()`.
`enrichTweet` (`react-tweet`'s `utils.js`, `getEntities`/`addEntities`)
unconditionally iterates `tweet.entities.hashtags`, `.urls`, `.user_mentions`,
and `.symbols` with `for...of`, assuming they are always arrays (its
TypeScript types mark them non-optional). Twitter's syndication API (what
`fetchTweet` calls) omits any of those keys entirely when a tweet has none of
that entity type. Fetching the actual tweet IDs hardcoded in both components
confirmed **every single one** was missing at least one of those keys (most
had only `user_mentions`), so `enrichTweet` threw
`TypeError: ... is not iterable` on every render. `MagicTweet` already caught
that throw and fell back to a "Tweet not found" card — so the page never
crashed — but the catch logged via `console.error`, which Cloud Run maps to
`severity=ERROR`, tripping the alert on effectively every hit to those pages.

**Fix.** Added `normalizeTweetEntities()`
(`src/lib/components/tweet-entities.ts`) to default the four entity arrays
(and a quoted tweet's, if present) to `[]` before calling `enrichTweet`, so
real tweet data renders instead of falling back. This is the actual
functional bug: testimonials were silently failing to render for real
visitors, not just spamming logs. The remaining catch in `MagicTweet` is
defense-in-depth for genuinely unexpected `enrichTweet` failures (already
falls back gracefully to `TweetNotFound`), downgraded to `console.warn` to
match — it no longer fires in practice once the known cause is fixed.

**Regression test.** `src/lib/components/tweet-entities.spec.ts` pins the
exact upstream failure mode (iterating a missing entity array throws) and
verifies `normalizeTweetEntities` fixes it while preserving entities that are
already present, including on a `quoted_tweet`.

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
| `llmgateway-worker`  | (no public URL — `ingress: internal`)                       | 8080 | 1 / 3             | Redis log/billing queue consumer + hourly stats aggregator      |

There is no `playground` or `docs` Cloud Run service deployed for this
project. No custom domain is mapped to the public services — they are
only reachable on their default `*.run.app` URLs.

**`llmgateway-worker` was missing from `third-culture` from the
2026-07-03 api/gateway/ui Cloud Run migration until 2026-07-08** — the
migration's `deploy-gcp.yml` only had matrix entries for `api`/`gateway`/`ui`,
so nothing ever drained the Redis log/billing queue or refreshed
`project_hourly_stats` in that window (visible as a gap in
`/internal/stats` from 2026-07-04 onward). It's deployed now (see the
`worker` matrix entry in `deploy-gcp.yml` and `apps/worker/src/health-server.ts`,
which exists purely to satisfy Cloud Run's container-contract startup
probe for an otherwise request-less background consumer).

The backlog itself was not lost: `gateway`/`api` only ever `LPUSH` request
logs onto the `log_queue_production` Redis list (see
`packages/cache/src/redis.ts`) rather than inserting into Postgres directly,
so the missing days' logs were still sitting in that list when the worker
came back (confirmed on redeploy — `/internal/stats` totals jumped by
several thousand requests as `processLogQueue` drained it).

**However, the per-day breakdown for 2026-07-04 through 2026-07-07 cannot be
recovered**, and shows up misattributed to the day the backlog was drained
instead: `LogInsertData` (`packages/db/src/types.ts`) deliberately omits
`createdAt` from the queue payload, so every backlog row lands in Postgres
with `createdAt = now()` at insert time, not the request's real timestamp.
`aggregateHistoricalStats`'s stale/backfill logic
(`apps/worker/src/services/project-stats-aggregator.ts`) only ever re-derives
`project_hourly_stats` from `log.created_at`, so it has no way to know those
rows actually belonged to earlier days. Net effect: total request/cost/token
counts across the gap are fully accurate (no data loss), but `GET
/internal/stats?days=N` will show a one-day spike on whichever day the
worker was redeployed and a permanent zero for the days in between. For
`tcs-monitoring`'s `llmgateway_completions_today` metric specifically (a
rolling 24h count) this self-corrects within a day and was not worth a
special-case fix; if per-day accuracy across outages like this ever matters,
the real fix is threading the gateway's original request timestamp through
the queue payload into `LogInsertData` instead of relying on the DB's
insert-time default.

All four services run from the same container image
(`us-central1-docker.pkg.dev/third-culture/tcs/llm-gateway`, pinned by
digest) under the `tcs-llm-gateway@third-culture.iam.gserviceaccount.com`
runtime service account, attached to the `tcs-llm-connector` VPC
connector (`private-ranges-only` egress) so they can reach private
backing services. `llmgateway-worker` additionally runs with
`run.googleapis.com/ingress: internal` (no `allUsers` invoker binding)
since it serves no real traffic, and `--no-cpu-throttling` /
`--min-instances=1` since its background loops must keep running
between requests to its health endpoint.

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
