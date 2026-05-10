#!/usr/bin/env bash
# Weekly aggregation export: tcs-llm-gateway Postgres -> tcs-metabase warehouse.
#
# Produces two tables in the warehouse:
#   - llmgateway_usage_daily    (one row per day, tenant, model)
#   - llmgateway_usage_monthly  (one row per month, tenant, model, with budget)
#
# Both tables are fully rebuilt each run (CREATE TABLE ... AS) so the job is
# idempotent — re-running it just produces the same result.
#
# Designed to run as a Cloud Run job on a Sunday 02:00 UTC schedule, but
# works fine from a laptop too.
#
# Required env vars:
#   TCS_LLM_DATABASE_URL     source Postgres (Cloud SQL) — read-only role OK
#   TCS_METABASE_DATABASE_URL destination Postgres (tcs-metabase warehouse)
#
# Both URLs can be pulled out of 1Password / Secret Manager at job start.

set -euo pipefail

: "${TCS_LLM_DATABASE_URL:?must be set}"
: "${TCS_METABASE_DATABASE_URL:?must be set}"

log() { printf "\033[1;34m[export]\033[0m %s\n" "$*"; }

DAILY_SQL=$(cat <<'SQL'
SELECT
    date_trunc('day', created_at)::date         AS day,
    api_key_id,
    ak.description                               AS tenant_key,
    project_id,
    organization_id,
    requested_model,
    used_model,
    used_provider,
    count(*)                                     AS request_count,
    sum((has_error)::int)                        AS error_count,
    sum((canceled)::int)                         AS canceled_count,
    sum(coalesce(prompt_tokens::numeric, 0))    AS prompt_tokens,
    sum(coalesce(completion_tokens::numeric, 0)) AS completion_tokens,
    sum(coalesce(reasoning_tokens::numeric, 0)) AS reasoning_tokens,
    sum(coalesce(total_tokens::numeric, 0))     AS total_tokens,
    sum(coalesce(cost, 0))                       AS cost_usd,
    percentile_cont(0.5)  within group (order by duration) AS p50_duration_ms,
    percentile_cont(0.95) within group (order by duration) AS p95_duration_ms,
    percentile_cont(0.99) within group (order by duration) AS p99_duration_ms,
    percentile_cont(0.95) within group (order by coalesce(time_to_first_token, 0)) AS p95_ttft_ms
FROM log l
LEFT JOIN api_key ak ON ak.id = l.api_key_id
WHERE created_at >= now() - interval '60 days'
GROUP BY 1,2,3,4,5,6,7,8
ORDER BY 1 DESC, tenant_key
SQL
)

MONTHLY_SQL=$(cat <<'SQL'
WITH raw AS (
  SELECT
      date_trunc('month', created_at)::date       AS month,
      api_key_id,
      ak.description                               AS tenant_key,
      ak.period_usage_limit::numeric               AS period_usage_limit,
      ak.period_usage_duration_value              AS period_usage_duration_value,
      ak.period_usage_duration_unit               AS period_usage_duration_unit,
      requested_model,
      used_model,
      used_provider,
      count(*)                                     AS request_count,
      sum((has_error)::int)                        AS error_count,
      sum(coalesce(total_tokens::numeric, 0))     AS total_tokens,
      sum(coalesce(cost, 0))                       AS cost_usd
  FROM log l
  LEFT JOIN api_key ak ON ak.id = l.api_key_id
  WHERE created_at >= now() - interval '13 months'
  GROUP BY 1,2,3,4,5,6,7,8,9
)
SELECT
    month,
    api_key_id,
    tenant_key,
    requested_model,
    used_model,
    used_provider,
    request_count,
    error_count,
    total_tokens,
    cost_usd,
    period_usage_limit                              AS monthly_budget_usd,
    CASE WHEN period_usage_limit IS NULL THEN NULL
         ELSE cost_usd / period_usage_limit END     AS budget_used_pct
FROM raw
ORDER BY month DESC, tenant_key
SQL
)

export_table() {
  local table="$1" sql="$2"
  log "exporting $table"
  local tmp
  tmp="$(mktemp -d)"
  local csv="$tmp/data.csv"
  local head="$tmp/head.csv"

  # Pull as CSV with header from source
  PGCONNECT_TIMEOUT=10 psql "$TCS_LLM_DATABASE_URL" \
    -v ON_ERROR_STOP=1 \
    -c "\\copy ($sql) TO '$csv' WITH (FORMAT csv, HEADER true)"

  head -n 1 "$csv" > "$head"

  # Load into destination: drop + recreate table from the CSV header, then copy.
  # We use a schema-less CREATE TABLE ... (text columns) to avoid type drift;
  # Metabase auto-casts on query. The warehouse owner can ALTER if needed.
  local columns
  columns="$(awk -F',' 'NR==1 {for (i=1;i<=NF;i++) printf "%s text%s", $i, (i==NF?"":", ")}' "$head")"

  PGCONNECT_TIMEOUT=10 psql "$TCS_METABASE_DATABASE_URL" \
    -v ON_ERROR_STOP=1 <<SQL
BEGIN;
DROP TABLE IF EXISTS ${table};
CREATE TABLE ${table} (${columns});
\\copy ${table} FROM '$csv' WITH (FORMAT csv, HEADER true)
COMMIT;
SQL

  local row_count
  row_count="$(wc -l < "$csv")"
  log "$table: $((row_count - 1)) rows"
  rm -rf "$tmp"
}

main() {
  if ! command -v psql >/dev/null; then
    echo "psql is required." >&2; exit 1
  fi
  export_table "llmgateway_usage_daily" "$DAILY_SQL"
  export_table "llmgateway_usage_monthly" "$MONTHLY_SQL"
  log "done."
}

main "$@"
