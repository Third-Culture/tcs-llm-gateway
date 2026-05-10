# Onboarding TCS services to the LLM gateway

This directory provides a single command for minting per-service API keys
with monthly budget caps, plus drop-in migration snippets for each TCS
service repo to switch from calling providers directly to calling the
gateway.

## One-time: create all service keys

```bash
# From a workstation with 1Password CLI signed in as di@thirdculture.world
./create-service-keys.sh \
    --api-url https://api.llm.thirdculture.systems \
    --admin-token "$(pbpaste)" \
    --project-id prj_xxx
```

- `--admin-token` is your `better-auth.session_token` cookie from the
  dashboard at <https://llm.thirdculture.systems>.
- `--project-id` is visible in the dashboard URL after selecting a project.
- Keys land in 1Password vault `TCS Team`, titled
  `tcs-llm-gateway / <service-name>`.

The script is idempotent: already-present keys are skipped (matched on
the `description` field).

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
team identified by `TCS_LINEAR_BUDGET_TEAM_ID`.

## Migration snippets per repo

Each TCS service should stop calling providers directly and instead call
the gateway with its own service key. The gateway exposes an
OpenAI-compatible `/v1/chat/completions` endpoint at
`https://api.llm.thirdculture.systems`.

### Python (tcs-metabase, salesforce-digify-sync)

```python
# pip install openai>=1.40
from openai import OpenAI

client = OpenAI(
    base_url="https://api.llm.thirdculture.systems/v1",
    api_key=os.environ["TCS_LLM_GATEWAY_KEY"],  # from 1Password
)

resp = client.chat.completions.create(
    model="tcs-balanced",   # or tcs-cheap / tcs-reasoning / tcs-premium
    messages=[{"role": "user", "content": "Summarize this ticket..."}],
)
```

Set `TCS_LLM_GATEWAY_KEY` in the service's deployed secret store
(Cloud Run env var, K8s secret, Metabase VM env file, etc.) using the
value from 1Password.

### Node.js / TypeScript (tcs-linear-automations, tcs-williams-services)

```ts
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: "https://api.llm.thirdculture.systems/v1",
    apiKey: process.env.TCS_LLM_GATEWAY_KEY,
});

const resp = await client.chat.completions.create({
    model: "tcs-reasoning",
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
curl https://api.llm.thirdculture.systems/v1/chat/completions \
  -H "Authorization: Bearer $TCS_LLM_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tcs-cheap",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

Response includes a `usage` block with token counts; costs are reported
on the dashboard within ~30 seconds.

## Removing a service

Revoke a key from the dashboard (or via `DELETE /keys/api/{id}`). The
1Password item can then be deleted manually from the `TCS Team` vault.
