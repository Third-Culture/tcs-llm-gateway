import { HTTPException } from "hono/http-exception";

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
	if (!provided || provided !== token) {
		throw new HTTPException(401, { message: "Invalid internal stats token" });
	}
}
