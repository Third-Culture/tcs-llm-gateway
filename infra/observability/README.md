# Observability

Three layers:

1. **Cloud Logging** — every gateway request logs a single JSON line with
   the TCS schema described below.
2. **Cloud Monitoring** — a dashboard + log-based metrics built on that
   schema. Deployed via `./apply-monitoring.sh`.
3. **Weekly Metabase export** — a Cloud Run job (or local cron) copies
   aggregate rows from the gateway's Postgres `log` table into the
   `tcs-metabase` warehouse so LLM spend sits next to the rest of TCS
   ops data.

## Log schema

The gateway emits one `INFO` log line per completed request from the
worker's post-transaction hook. The `jsonPayload` looks like:

```json
{
  "event": "llm.request",
  "request_id": "req_01HXY...",
  "organization_id": "org_...",
  "project_id": "prj_...",
  "api_key_id": "key_...",
  "tenant_key": "tcs-williams-services",
  "requested_model": "tcs-reasoning",
  "used_model": "kimi-k2.6",
  "used_provider": "parasail",
  "streamed": true,
  "cached": false,
  "canceled": false,
  "has_error": false,
  "finish_reason": "stop",
  "prompt_tokens": 1342,
  "completion_tokens": 488,
  "reasoning_tokens": 220,
  "total_tokens": 2050,
  "cost_usd": 0.00487,
  "duration_ms": 2184,
  "ttft_ms": 410
}
```

`tenant_key` is set to the API key's description (the service name from
`infra/onboarding/services.json`) so dashboards can slice by service
without joining to the DB.

Errors emit a second line with `event=llm.error` and `error_details`.

## Log-based metrics

`./apply-monitoring.sh` creates these log-based metrics (distribution or
counter) in the `third-culture` project:

| Metric name                              | Type   | Label(s)                     | Source |
| ---------------------------------------- | ------ | ---------------------------- | ------ |
| `llmgateway/cost_usd`                    | dist   | tenant_key, used_model       | `cost_usd` |
| `llmgateway/total_tokens`                | dist   | tenant_key, used_model       | `total_tokens` |
| `llmgateway/request_duration_ms`         | dist   | tenant_key, used_model       | `duration_ms` |
| `llmgateway/ttft_ms`                     | dist   | tenant_key, used_model       | `ttft_ms` |
| `llmgateway/fallback_rate`               | counter| used_provider                | fires when `requested_model != used_model` |
| `llmgateway/error_rate`                  | counter| tenant_key, used_provider    | fires when `event=llm.error` |

The dashboard in [`dashboard.json`](dashboard.json) charts these.

## Weekly Metabase export

[`export-to-metabase.sh`](export-to-metabase.sh) runs weekly (Sunday
02:00 UTC) via a Cloud Run job and writes two aggregated tables into
the `tcs-metabase` warehouse:

- `llmgateway_usage_daily` — one row per (day, tenant, model) with token
  totals, cost, error rate, p95 latency.
- `llmgateway_usage_monthly` — same shape, monthly granularity, plus
  budget-vs-actual columns.

## Deploying

```bash
cd infra/observability
./apply-monitoring.sh         # creates log metrics + dashboard
./schedule-weekly-export.sh   # (one-time) create Cloud Scheduler job
```
