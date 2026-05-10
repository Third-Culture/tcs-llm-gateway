# Onboarding TCS services to the LLM gateway

This directory provides a single command for minting per-service API keys
with monthly budget caps, plus drop-in migration snippets for each TCS
service repo to switch from calling providers directly to calling the
gateway.

## Where things live (truth)

| Resource           | Location                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Gateway base URL   | `https://llmgateway-gateway-qm3fwjoi5q-uc.a.run.app/v1` (us-central1)   |
| Dashboard UI       | `https://llmgateway-ui-qm3fwjoi5q-uc.a.run.app`                         |
| Internal API       | `https://llmgateway-api-qm3fwjoi5q-uc.a.run.app`                        |
| Per-service keys   | GCP Secret Manager in `third-culture`: `tcs-llm-key-<service>`          |
| Image registry     | `us-central1-docker.pkg.dev/third-culture/tcs/llm-gateway`              |
| Deploy SA          | `tcs-llm-deployer@third-culture.iam.gserviceaccount.com`                |

The custom domain (`llm.thirdculture.systems`) is configured in Terraform
under `infra/gcp/terraform/main.tf` but the DNS verification has not been
completed yet — for now, use the `*.run.app` URLs directly. They are stable.

## One-time: create all service keys

```bash
./create-service-keys.sh \
    --api-url https://llmgateway-api-qm3fwjoi5q-uc.a.run.app \
    --admin-token "$(pbpaste)" \
    --project-id prj_xxx
```

- `--admin-token` is your `better-auth.session_token` cookie from the
  dashboard at <https://llmgateway-ui-qm3fwjoi5q-uc.a.run.app>.
- `--project-id` is visible in the dashboard URL after selecting a project.

The script writes keys to GCP Secret Manager directly (and tries to
mirror to 1Password if the operator's `op` CLI session has write access
to the `TCS Team` vault). It is idempotent: already-present keys are
left untouched (matched on the `description` field).

Mirroring to 1Password is best-effort: the standing 1Password Service
Account token has read-only access to all org vaults. To add a key to
1Password, an admin must do it manually with their personal session
(or grant the SA write access to a dedicated `TCS LLM Gateway` vault).

Defaults come from [`services.json`](services.json):

| Service                   | Default model     | Monthly cap |
| ------------------------- | ----------------- | ----------- |
| salesforce-digify-sync    | tcs-balanced      | $50         |
| tcs-metabase              | tcs-cheap         | $75         |
| tcs-linear-automations    | tcs-reasoning     | $100        |
| tcs-williams-services     | tcs-balanced      | $150        |
| dev-shared                | tcs-cheap         | $25         |

When a key crosses 80% or 100% of its monthly cap, the worker posts to
Slack (`TCS_SLACK_BUDGET_WEBHOOK_URL`) and opens a Linear issue in the
team identified by `TCS_LINEAR_BUDGET_TEAM_ID`. Both env vars are
optional — without them the alerts are written to structured logs only.

## Budget enforcement, in priority order

1. **Hard cap (server-side, gateway)**: every API key has a
   `periodUsageLimit` and a duration. Once exceeded, the gateway
   rejects subsequent requests with `429 budget_exceeded` until the
   period rolls over. This is the source of truth.
2. **Soft alert (worker)**: as the meter crosses 80% and 100%, the
   worker (`apps/worker/src/services/tcs-budget-alerts.ts`) emits a
   warn-level structured log with the threshold and, if configured,
   posts to Slack and opens a Linear issue. Dedup is keyed on
   (apiKeyId, periodStartedAt, threshold) with a 40-day Redis TTL.
3. **Catch-all (GCP billing budget)**: optional. Create a project-
   level monthly budget on the Williams billing account
   (`0177E9-12D085-5DA958`) covering the entire `third-culture`
   project at e.g. \$500/month with thresholds at 50%/80%/100%.
   Budgets only track raw GCP spend (Cloud Run, Secret Manager,
   networking) — they do **not** see LLM provider spend, which is
   billed to the per-provider accounts and tracked exclusively in
   the gateway's database.

## Migration snippets per repo

Each TCS service should stop calling providers directly and instead call
the gateway with its own service key. The gateway exposes an
OpenAI-compatible `/v1/chat/completions` endpoint at
`https://api.llm.thirdculture.systems`.

### Python (tcs-metabase, wr_salesforce_digify_sync)

```python
# pip install openai>=1.40
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["TCS_LLM_BASE_URL"],
    api_key=os.environ["TCS_LLM_API_KEY"],
)

resp = client.chat.completions.create(
    model=os.environ.get("TCS_LLM_MODEL", "tcs-cheap"),
    messages=[{"role": "user", "content": "Summarize this ticket..."}],
)
```

Set the three `TCS_LLM_*` env vars in the service's deploy config —
`TCS_LLM_API_KEY` should reference Secret Manager (cross-project from
`third-culture` if the service runs in another project), and the other
two can be plain env vars.

### Node.js / TypeScript (tcs-linear-automations, services-api)

```ts
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: process.env.TCS_LLM_BASE_URL!,
    apiKey: process.env.TCS_LLM_API_KEY!,
});

const resp = await client.chat.completions.create({
    model: process.env.TCS_LLM_MODEL ?? "tcs-cheap",
    messages: [{ role: "user", content: "Review this evidence..." }],
});
```

### Choosing a tier

- `tcs-cheap` — mimo-v2-flash first, very cheap, great for classification,
  extraction, and bulk summarization where quality variance is OK.
- `tcs-balanced` — minimax-m2.7 via Fireworks, the default. Use unless
  you have a reason to pick something else.
- `tcs-reasoning` — kimi-k2.6 via Parasail. Multi-step reasoning, agentic
  tool-use, verification bots.
- `tcs-premium` — gemini-3.1-preview on Vertex. Highest quality, most
  expensive. Reserve for customer-facing outputs and hard reasoning.
- `tcs-vision` — same as premium but optimized for images. Falls back to
  kimi-k2.5.

### Verifying it works

```bash
TCS_LLM_API_KEY=$(gcloud secrets versions access latest \
    --secret=tcs-llm-key-<service> --project=third-culture)

curl https://llmgateway-gateway-qm3fwjoi5q-uc.a.run.app/v1/chat/completions \
  -H "Authorization: Bearer $TCS_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tcs-cheap",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

Response includes a `usage` block with token counts; costs are reported
on the dashboard within ~30 seconds.

## Removing a service

Revoke a key from the dashboard (or via `DELETE /keys/api/{id}`). Then
revoke the GCP Secret Manager secret with `gcloud secrets delete
tcs-llm-key-<service>`.
