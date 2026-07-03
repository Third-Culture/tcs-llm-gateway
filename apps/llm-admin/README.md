# llm-admin

Custom TCS-branded chat UI for the LLM Gateway, deployed at
[llm.thirdculture.systems](https://llm.thirdculture.systems). This is a
small standalone Express app (not part of the Next.js `apps/ui` dashboard) —
it's a thin, Google SSO-gated frontend + reverse-proxy that talks to this
repo's real `apps/gateway` and `apps/api` services over HTTP.

This app's source used to live in the separate `tcs-systems-infra` repo. It
now lives here so it can be developed and reviewed alongside the gateway it
depends on. See "Deployment" below for how it still gets shipped.

## What it does

- Google Sign-In restricted to `@thirdculture.world` accounts (verified via
  Google's `tokeninfo` endpoint — no server-side OAuth client secret needed).
- A cross-domain login broker: `llm.thirdculture.systems` redirects to
  `thirdculture.systems/llm-login`, which signs a short-lived HMAC transfer
  token and redirects back to `/auth/complete` to establish the session. This
  lets the tool share a login experience with other `*.thirdculture.systems`
  tools without OAuth client changes.
- A chat panel that streams `/v1/chat/completions` from `LLM_GATEWAY_URL`
  using an internal, server-side-only API key, showing per-request cost
  (parsed from the gateway's final SSE usage chunk) and a running session
  total.
- A usage panel that proxies `GET /internal/stats` on `LLM_INTERNAL_URL`
  (the management API), authenticated with a bearer token.
- A routing panel showing the health of each `tcs-*` virtual model tier
  (which provider/model it's currently routed to, fallback chain, last
  checked time, latency), proxying `GET /internal/tcs-tier-routing-status`
  on `LLM_INTERNAL_URL` with the same bearer token. Includes a "Run check
  now" button that proxies `POST /internal/tcs-tier-routing-status/run` to
  trigger an on-demand check instead of waiting for the hourly worker job.

## Environment variables

| Variable             | Required | Description                                                                                                                                                   |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`   | yes      | Google OAuth client ID used for Sign-In With Google (no secret needed, GIS popup flow). Must allow `https://thirdculture.systems` as an authorized JS origin. |
| `SESSION_SECRET`     | yes      | Random string (`openssl rand -hex 32`) used to sign session cookies and the login-broker transfer token.                                                      |
| `LLM_API_KEY`        | yes      | A gateway API key (server-side only, never exposed to the browser) used for all chat completions sent through this tool.                                      |
| `LLM_INTERNAL_TOKEN` | no       | Bearer token matching the management API's `INTERNAL_STATS_TOKEN`. Without it, the Usage and Routing tabs report empty state with a note instead of erroring. |
| `LLM_GATEWAY_URL`    | no       | Base URL of the gateway. Defaults to the live `third-culture` deployment.                                                                                     |
| `LLM_INTERNAL_URL`   | no       | Base URL of the management API. Defaults to the live `third-culture` deployment.                                                                              |
| `PORT`               | no       | Defaults to `7070`.                                                                                                                                           |

## Local development

```bash
cd apps/llm-admin
pnpm install
GOOGLE_CLIENT_ID=... SESSION_SECRET=... LLM_API_KEY=... pnpm dev
```

## Deployment

This app is **not** deployed via Cloud Run like `gateway`/`api`/`ui`. It runs
in a Docker Compose stack (`tcs_metabase`) on the `metabase-instance` Compute
Engine VM in the `third-culture` GCP project, alongside `metabase`,
`okr-admin`, and `blog-admin`, fronted by a shared Caddy reverse proxy that
routes `llm.thirdculture.systems` to this container on port 7070.

That compose stack's source lives in the separate, private
`Third-Culture/tcs-systems-infra` repo (`docker-compose.yml`, `Caddyfile`) —
this repo (`tcs-llm-gateway`) is the source of truth for the `llm-admin`
application code itself. To ship a change:

1. Merge your change to this app in `tcs-llm-gateway`.
2. Sync the updated `apps/llm-admin/{src,public,package.json,Dockerfile}`
   into `tcs-systems-infra/llm-admin/` on the VM (or via a PR to that repo,
   whichever is current practice) — the compose build context there expects
   the same `Dockerfile` + `package.json` + `src/` + `public/` layout.
3. On the VM: `cd /services/tcs_metabase && sudo docker compose build llm-admin && sudo docker compose up -d llm-admin`.
4. Verify: `curl -s https://llm.thirdculture.systems/ -o /dev/null -w '%{http_code}\n'`
   and a manual login/chat smoke test in the browser.

This two-repo split is a known wart (see `infra/gcp/README.md` in this repo
for more on the general deployment landscape) — consider migrating the
compose stack itself into this repo if `llm-admin` grows further.
