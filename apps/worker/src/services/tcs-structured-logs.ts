import { logger } from "@llmgateway/logger";

import type { LogInsertData } from "@llmgateway/db";

/**
 * Emit one INFO line per LLM request with a stable JSON schema so Cloud
 * Logging + log-based metrics can aggregate on tenant_key, model, provider,
 * cost, latency, etc. without joining to the Postgres `log` table.
 *
 * The schema is documented in `infra/observability/README.md`.
 */
export function emitTcsStructuredLogs(
	records: Array<LogInsertData | Omit<LogInsertData, "messages" | "content">>,
	apiKeyDescriptions: Map<string, string | null>,
): void {
	for (const r of records) {
		const tenantKey = apiKeyDescriptions.get(r.apiKeyId) ?? null;
		const requestedModel = r.requestedModel;
		const usedModel = r.usedModel;
		const fallback =
			requestedModel && usedModel
				? requestedModel.split("@")[0] !== usedModel.split("@")[0]
				: false;

		const payload = {
			event: r.hasError ? "llm.error" : "llm.request",
			request_id: r.requestId,
			organization_id: r.organizationId,
			project_id: r.projectId,
			api_key_id: r.apiKeyId,
			tenant_key: tenantKey,
			requested_model: requestedModel,
			used_model: usedModel,
			used_provider: r.usedProvider,
			streamed: Boolean(r.streamed),
			cached: Boolean(r.cached),
			canceled: Boolean(r.canceled),
			has_error: Boolean(r.hasError),
			finish_reason: r.finishReason ?? null,
			prompt_tokens: numOrNull(r.promptTokens),
			completion_tokens: numOrNull(r.completionTokens),
			reasoning_tokens: numOrNull(r.reasoningTokens),
			total_tokens: numOrNull(r.totalTokens),
			cost_usd: r.cost ?? null,
			duration_ms: r.duration,
			ttft_ms: r.timeToFirstToken ?? null,
			fallback,
			error_details: r.hasError ? (r.errorDetails ?? null) : undefined,
		};

		if (r.hasError) {
			// Log errors at WARN severity so Monitoring alerts can page on them.
			logger.warn("llm.error", payload);
		} else {
			logger.info("llm.request", payload);
		}
	}
}

function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined) {
		return null;
	}
	const n = typeof v === "string" ? Number.parseFloat(v) : (v as number);
	return Number.isFinite(n) ? n : null;
}
