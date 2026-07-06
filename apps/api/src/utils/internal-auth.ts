import { timingSafeEqual } from "node:crypto";

import { HTTPException } from "hono/http-exception";

/**
 * Shared bearer-token guard for `/internal/*` routes consumed by trusted
 * internal tools (e.g. the llm-admin chat UI, and status.thirdculture.systems
 * — see catalog entry `llmgateway-api` in Third-Culture/tcs-monitoring).
 */
export function requireInternalStatsToken(
	authorization: string | undefined,
): void {
	const token = process.env.INTERNAL_STATS_TOKEN;
	if (!token) {
		throw new HTTPException(501, {
			message: "INTERNAL_STATS_TOKEN is not configured on this deployment",
		});
	}
	const provided = authorization?.startsWith("Bearer ")
		? authorization.slice("Bearer ".length)
		: undefined;
	if (!provided || !constantTimeEquals(provided, token)) {
		throw new HTTPException(401, { message: "Invalid internal stats token" });
	}
}

// Same length-then-timingSafeEqual pattern used for the llm-admin transfer
// token (apps/llm-admin/src/server.ts) — a plain `!==` leaks timing
// information proportional to the number of matching leading characters.
function constantTimeEquals(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
