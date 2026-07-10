const INFRA_ERROR_PATTERNS = [
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"EPIPE",
	"connection terminated",
	"Connection terminated unexpectedly",
	"the database system is starting up",
	"the database system is shutting down",
	"too many clients already",
	"remaining connection slots",
	"sorry, too many clients",
	"could not connect to server",
	"no pg_hba.conf entry",
	"Connection timed out",
	"Redis connection",
	"maxRetriesPerRequest",
];

export function isInfrastructureError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message;
	if (INFRA_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
		return true;
	}

	const code = (error as { code?: string }).code;
	if (
		code &&
		["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(code)
	) {
		return true;
	}

	return false;
}
