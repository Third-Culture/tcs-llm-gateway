import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { db, gte, projectHourlyStats, sql } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const internalStats = new OpenAPIHono<ServerTypes>();

internalStats.use("/*", async (c, next) => {
	const token = process.env.INTERNAL_STATS_TOKEN;
	if (!token) {
		throw new HTTPException(503, { message: "Internal stats not configured" });
	}
	const auth = c.req.header("Authorization");
	if (!auth || auth !== `Bearer ${token}`) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	return await next();
});

internalStats.get("/stats", async (c) => {
	const sevenDaysMs = 604_800_000;
	const since = new Date(Date.now() - sevenDaysMs);

	const rows = await db
		.select({
			day: sql<string>`date_trunc('day', ${projectHourlyStats.hourTimestamp})::text`,
			requests: sql<number>`SUM(${projectHourlyStats.requestCount})::int`,
			errors: sql<number>`SUM(${projectHourlyStats.errorCount})::int`,
			cost: sql<number>`SUM(${projectHourlyStats.cost})::float`,
			inputTokens: sql<number>`SUM(${projectHourlyStats.inputTokens}::numeric)::float`,
			outputTokens: sql<number>`SUM(${projectHourlyStats.outputTokens}::numeric)::float`,
		})
		.from(projectHourlyStats)
		.where(gte(projectHourlyStats.hourTimestamp, since))
		.groupBy(sql`date_trunc('day', ${projectHourlyStats.hourTimestamp})`)
		.orderBy(sql`date_trunc('day', ${projectHourlyStats.hourTimestamp})`);

	const totals = rows.reduce(
		(acc, r) => ({
			requests: acc.requests + (r.requests ?? 0),
			errors: acc.errors + (r.errors ?? 0),
			cost: acc.cost + (r.cost ?? 0),
		}),
		{ requests: 0, errors: 0, cost: 0 },
	);

	return c.json({ days: rows, totals });
});
