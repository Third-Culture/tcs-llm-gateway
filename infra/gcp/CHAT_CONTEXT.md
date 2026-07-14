# Chat context — usage redesign + UI auth (Jul 2026)

Internal ops notes from the TCS LLM Gateway workstream. No credentials.

## What shipped

### Usage attribution (llm-admin + API)

- Cost-first usage UI: chart tabs for **Cost / Requests / Tokens**, daily cost as default.
- Breakdowns by app/service (API key) and by human (personal keys only).
- `apiKey.usageType`: `personal` | `service`. Users breakdown filters to `personal`.
- `PATCH /keys/api/{id}/usage-type` to reclassify keys.
- Attribution: primarily `apiKey.createdBy`; optional `X-LLMGateway-User-ID` for finer human tags if needed.

### Product UI hosting

- Custom domain: `https://llm-gateway.thirdculture.systems` (Caddy on GCE → Cloud Run UI).
- Landing card on `https://thirdculture.systems` (portal `services.yml` + gateway icon) — lives in **tcs-systems-infra**, not this repo.
- API `ORIGIN_URLS` must include the custom domain (Cloud Run env on `llmgateway-api`).

### Auth / login loop fixes (this repo)

Cross-origin deploy: session cookie is on **API** host (`llmgateway-api-*.run.app`), not the UI host. SSR that reads UI cookies for session always fails.

Fixes on `main`:

| Commit | Change |
|--------|--------|
| `c9af4727` | `useUser` dep array + passkey autofill once-per-tab |
| `fed66e19` | Drop SSR auth redirects on `/dashboard`; client index redirect |
| `8a7dd77c` | Don’t treat failed SSR project fetch as Unauthorized |
| `8efde48d` | Tweet embed `enrichTweet` try/catch (RSC nav crash) |

Client-side `useUser` + `credentials: "include"` remain the source of truth for session on this deployment.

## Key decisions

1. **One company, one team** — prefer low-friction attribution via key creator + `usageType`, not mandatory per-request user IDs.
2. **CEO view** — cost first; distinguish human vs service spend so service keys don’t inflate personal totals.
3. **Keep host-only cookies on `*.run.app`** — do not invent a shared `Cookie-Domain` across API/UI on the public suffix list; fix SSR gates instead (or later put UI+API under a shared non-PSL domain).

## Outstanding work

- [ ] Reclassify existing API keys as `personal` vs `service` in prod so usage by-user isn’t dominated by “key creator = CEO”.
- [ ] Confirm end-to-end login + dashboard (org/project pages) after latest SSR Unauthorized fix; harden any remaining SSR paths that assume UI cookies.
- [ ] Optional: shared first-party domain for UI+API (or BFF) so SSR `getUser` / `fetchServerData` auth works again.
- [ ] Update 1Password for product UI login if password was rotated outside the vault (do not store passwords in git).
- [ ] Sync portal/infra card health path if UI `/api/health` differs from what’s configured in `services.yml`.
- [ ] Display name cleanup (e.g. wrong “DI Roberts” display) if still wrong in `user` table — product settings / admin, not gateway traffic.

## Useful URLs

| Surface | URL |
|---------|-----|
| Product UI | https://llm-gateway.thirdculture.systems |
| Cloud Run UI | https://llmgateway-ui-303980490211.us-central1.run.app |
| Usage admin (`llm-admin`) | https://llm.thirdculture.systems |
| GCP project | `third-culture` (Cloud Run: `llmgateway-ui`, `llmgateway-api`, `llmgateway-gateway`) |

## Out of scope / do not commit

Secrets, rotated passwords, scratch dumps under `/tmp`, and Caddy/portal edits that belong in **tcs-systems-infra**.
