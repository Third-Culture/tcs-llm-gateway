import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, gte, projectHourlyStats, sql } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const internalStats = new OpenAPIHono<ServerTypes>();

const STATS_WINDOW_DAYS = 7;

function requireInternalStatsToken(authorization: string | undefined): void {
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

const dailyStatsSchema = z.object({
	day: z.string(),
	requests: z.number(),
});

const statsResponseSchema = z.object({
	totals: z.object({
		requests: z.number(),
		errors: z.number(),
		cost: z.number(),
	}),
	days: z.array(dailyStatsSchema),
});

// GET /internal/stats - Gateway-wide request/error/cost totals for the last
// 7 days, used by internal tools (e.g. the llm-admin chat UI's Usage tab).
// Deliberately not scoped to a single organization/project: this deployment
// is TCS-internal only, so "gateway-wide" is the intended, safe scope.
const getStatsRoute = createRoute({
	operationId: "internal_get_stats",
	summary: "Get gateway-wide usage stats",
	description:
		"Returns request counts, error counts, and cost aggregated across the whole gateway for the last 7 days. Requires a Bearer token matching INTERNAL_STATS_TOKEN.",
	method: "get",
	path: "/stats",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: statsResponseSchema,
				},
			},
			description: "Gateway-wide usage totals and daily request counts",
		},
	},
});

internalStats.openapi(getStatsRoute, async (c) => {
	requireInternalStatsToken(c.req.header("Authorization"));

	const STATS_WINDOW_MS = STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
	const since = new Date(Date.now() - STATS_WINDOW_MS);

	const dailyRows = await db
		.select({
			day: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("day"),
			requests:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"requests",
				),
			errors:
				sql<number>`COALESCE(SUM(${projectHourlyStats.errorCount}), 0)`.as(
					"errors",
				),
			cost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlyStats)
		.where(gte(projectHourlyStats.hourTimestamp, since))
		.groupBy(sql`DATE(${projectHourlyStats.hourTimestamp})`)
		.orderBy(sql`DATE(${projectHourlyStats.hourTimestamp}) ASC`);

	const totals = dailyRows.reduce(
		(acc, row) => ({
			requests: acc.requests + Number(row.requests),
			errors: acc.errors + Number(row.errors),
			cost: acc.cost + Number(row.cost),
		}),
		{ requests: 0, errors: 0, cost: 0 },
	);

	return c.json({
		totals,
		days: dailyRows.map((row) => ({
			day: row.day,
			requests: Number(row.requests),
		})),
	});
});
