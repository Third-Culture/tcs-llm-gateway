const INFRA_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
	"EPIPE",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
]);

const INFRA_ERROR_PATTERNS = [
	/connection\s+terminated\s+unexpectedly/i,
	/cannot\s+acquire\s+a\s+connection/i,
	/pool\s+is\s+ended/i,
	/connection\s+pool\s+exhausted/i,
	/too\s+many\s+clients/i,
	/remaining\s+connection\s+slots\s+are\s+reserved/i,
	/Connection\s+terminated/i,
	/Redis\s+connection/i,
	/getaddrinfo\s+ENOTFOUND/i,
	/connect\s+ECONNREFUSED/i,
	/socket\s+hang\s+up/i,
	/read\s+ECONNRESET/i,
];

/**
 * Detects transient infrastructure errors (DB/Redis connectivity, DNS failures)
 * that are operational conditions rather than application bugs.
 */
export function isInfrastructureError(error: Error): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	if (code && INFRA_ERROR_CODES.has(code)) {
		return true;
	}

	const message = error.message;
	for (const pattern of INFRA_ERROR_PATTERNS) {
		if (pattern.test(message)) {
			return true;
		}
	}

	const cause = (error as { cause?: unknown }).cause;
	if (cause instanceof Error) {
		return isInfrastructureError(cause);
	}

	return false;
}
