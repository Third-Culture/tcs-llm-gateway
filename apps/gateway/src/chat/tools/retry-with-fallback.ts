export const MAX_RETRIES = 2;

export type RetryableErrorType =
	| "network_error"
	| "provider_error"
	| "upstream_error"
	| "upstream_timeout";

export interface RoutingAttempt {
	provider: string;
	model: string;
	region?: string;
	status_code: number;
	error_type: string;
	succeeded: boolean;
	apiKeyHash?: string;
	logId?: string;
}

/**
 * @deprecated Use RoutingAttempt instead
 */
export type FailedAttempt = RoutingAttempt;

export function isRetryableErrorType(errorType: string): boolean {
	return (
		errorType === "network_error" ||
		errorType === "provider_error" ||
		errorType === "upstream_error" ||
		errorType === "upstream_timeout"
	);
}

/**
 * Determines whether a failed request should be retried with a different provider.
 * Retries when the error is retryable, retry count hasn't been exceeded, fallback
 * hasn't been disabled, and alternative providers are available.
 *
 * Note: this also applies when a specific provider was explicitly requested
 * (e.g. "deepinfra/deepinfra-llama-4-maverick"). In that case `remainingProviders`
 * is only > 0 when the caller (chat.ts) has widened the routing metadata to
 * include other providers serving the same model, so the explicitly requested
 * provider is always tried first and this only kicks in as a waterfall on
 * transient failures (rate limits, overload, 5xx) — unless the caller disabled
 * fallback via `noFallback` / `X-No-Fallback`.
 */
export function shouldRetryRequest(opts: {
	requestedProvider: string | undefined;
	noFallback: boolean;
	errorType: string;
	retryCount: number;
	remainingProviders: number;
	usedProvider: string;
}): boolean {
	if (opts.noFallback) {
		return false;
	}
	if (!isRetryableErrorType(opts.errorType)) {
		return false;
	}
	if (opts.retryCount >= MAX_RETRIES) {
		return false;
	}
	if (opts.remainingProviders <= 0) {
		return false;
	}
	if (opts.usedProvider === "custom" || opts.usedProvider === "llmgateway") {
		return false;
	}
	return true;
}

/**
 * Build a composite key for identifying a provider+region combination.
 * Used by the retry system to track which provider-region pairs have been tried.
 */
export function providerRetryKey(providerId: string, region?: string): string {
	return region ? `${providerId}:${region}` : providerId;
}

/**
 * Selects the next-best provider from the scored provider list,
 * excluding any providers that have already been tried and failed.
 * Returns the provider mapping with providerId and modelName, or null if none available.
 * When region is present on scores, uses composite providerId:region keys for deduplication.
 */
export function selectNextProvider(
	providerScores: Array<{
		providerId: string;
		score: number;
		region?: string;
		excludedByContentFilter?: boolean;
	}>,
	failedProviders: Set<string>,
	modelProviders: Array<{
		providerId: string;
		modelName: string;
		region?: string;
	}>,
): { providerId: string; modelName: string; region?: string } | null {
	const sorted = [...providerScores].sort((a, b) => a.score - b.score);
	for (const score of sorted) {
		if (score.excludedByContentFilter) {
			continue;
		}

		const key = providerRetryKey(score.providerId, score.region);
		if (failedProviders.has(key)) {
			continue;
		}
		const mapping = modelProviders.find(
			(p) => p.providerId === score.providerId && p.region === score.region,
		);
		if (mapping) {
			return mapping;
		}
	}
	return null;
}

/**
 * Maps an HTTP status code to a human-readable error type for the routing metadata.
 */
export function getErrorType(statusCode: number): string {
	if (statusCode === 0) {
		return "network_error";
	}
	if (statusCode === 429) {
		return "rate_limited";
	}
	return "upstream_error";
}
