import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { requireInternalStatsToken } from "@/utils/internal-auth.js";

import {
	and,
	apiKey,
	apiKeyHourlyStats,
	db,
	desc,
	eq,
	gte,
	project,
	projectHourlyStats,
	sql,
	user,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const internalStats = new OpenAPIHono<ServerTypes>();

// projectHourlyStats rows are never purged, so history is available for as
// long as the database keeps them; this just bounds how much of it a single
// request can pull back.
const DEFAULT_STATS_WINDOW_DAYS = 30;
const MAX_STATS_WINDOW_DAYS = 90;

const dailyStatsSchema = z.object({
	day: z.string(),
	requests: z.number(),
	cost: z.number(),
	totalTokens: z.number(),
});

const statsResponseSchema = z.object({
	totals: z.object({
		requests: z.number(),
		errors: z.number(),
		cost: z.number(),
	}),
	days: z.array(dailyStatsSchema),
});

const statsQuerySchema = z.object({
	days: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_STATS_WINDOW_DAYS)
		.optional()
		.openapi({
			description: `Number of days of history to return (max ${MAX_STATS_WINDOW_DAYS}). Defaults to ${DEFAULT_STATS_WINDOW_DAYS}.`,
			example: DEFAULT_STATS_WINDOW_DAYS,
		}),
});

// GET /internal/stats - Gateway-wide request/error/cost totals, used by
// internal tools (e.g. the llm-admin chat UI's Usage tab). Backed by the
// project_hourly_stats table, which is retained indefinitely (not subject to
// the per-org log retention window), so history beyond the default window is
// available via the `days` query param.
// Deliberately not scoped to a single organization/project: this deployment
// is TCS-internal only, so "gateway-wide" is the intended, safe scope.
const getStatsRoute = createRoute({
	operationId: "internal_get_stats",
	summary: "Get gateway-wide usage stats",
	description: `Returns request counts, error counts, and cost aggregated across the whole gateway for the last N days (default ${DEFAULT_STATS_WINDOW_DAYS}, max ${MAX_STATS_WINDOW_DAYS}, via the \`days\` query param). Requires a Bearer token matching INTERNAL_STATS_TOKEN.`,
	method: "get",
	path: "/stats",
	request: {
		query: statsQuerySchema,
	},
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

	const { days } = c.req.valid("query");
	const windowDays = days ?? DEFAULT_STATS_WINDOW_DAYS;
	const STATS_WINDOW_MS = windowDays * 24 * 60 * 60 * 1000;
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
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"totalTokens",
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
			cost: Number(row.cost),
			totalTokens: Number(row.totalTokens),
		})),
	});
});

const consumerStatsSchema = z.object({
	apiKeyId: z.string(),
	description: z.string(),
	usageType: z.enum(["personal", "service"]),
	projectId: z.string(),
	projectName: z.string(),
	requests: z.number(),
	errors: z.number(),
	cost: z.number(),
});

const consumerStatsResponseSchema = z.object({
	consumers: z.array(consumerStatsSchema),
});

// GET /internal/stats/by-consumer - Usage broken down per API key ("consumer" /
// application), joined against api_key.description and project.name for
// display labels. Backed by api_key_hourly_stats, the api-key-grained sibling
// of project_hourly_stats used by the gateway-wide /internal/stats route.
// Note: attribution is only as granular as how keys were provisioned — if
// multiple apps share one API key, they cannot be distinguished here.
const getConsumerStatsRoute = createRoute({
	operationId: "internal_get_stats_by_consumer",
	summary: "Get usage stats broken down by API key (consumer/application)",
	description: `Returns request counts, error counts, and cost per API key for the last N days (default ${DEFAULT_STATS_WINDOW_DAYS}, max ${MAX_STATS_WINDOW_DAYS}, via the \`days\` query param), labeled with the key's description and project name. Requires a Bearer token matching INTERNAL_STATS_TOKEN.`,
	method: "get",
	path: "/stats/by-consumer",
	request: {
		query: statsQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: consumerStatsResponseSchema,
				},
			},
			description: "Usage totals per API key (consumer)",
		},
	},
});

internalStats.openapi(getConsumerStatsRoute, async (c) => {
	requireInternalStatsToken(c.req.header("Authorization"));

	const { days } = c.req.valid("query");
	const windowDays = days ?? DEFAULT_STATS_WINDOW_DAYS;
	const STATS_WINDOW_MS = windowDays * 24 * 60 * 60 * 1000;
	const since = new Date(Date.now() - STATS_WINDOW_MS);

	const rows = await db
		.select({
			apiKeyId: apiKeyHourlyStats.apiKeyId,
			description: apiKey.description,
			usageType: apiKey.usageType,
			projectId: apiKeyHourlyStats.projectId,
			projectName: project.name,
			requests:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"requests",
				),
			errors: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
				"errors",
			),
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
		})
		.from(apiKeyHourlyStats)
		.innerJoin(apiKey, eq(apiKeyHourlyStats.apiKeyId, apiKey.id))
		.innerJoin(project, eq(apiKeyHourlyStats.projectId, project.id))
		.where(gte(apiKeyHourlyStats.hourTimestamp, since))
		.groupBy(
			apiKeyHourlyStats.apiKeyId,
			apiKey.description,
			apiKey.usageType,
			apiKeyHourlyStats.projectId,
			project.name,
		)
		.orderBy(desc(sql`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`));

	return c.json({
		consumers: rows.map((row) => ({
			apiKeyId: row.apiKeyId,
			description: row.description,
			usageType: row.usageType,
			projectId: row.projectId,
			projectName: row.projectName,
			requests: Number(row.requests),
			errors: Number(row.errors),
			cost: Number(row.cost),
		})),
	});
});

const userStatsSchema = z.object({
	userId: z.string(),
	name: z.string().nullable(),
	email: z.string(),
	apiKeyCount: z.number(),
	requests: z.number(),
	errors: z.number(),
	cost: z.number(),
});

const userStatsResponseSchema = z.object({
	users: z.array(userStatsSchema),
});

// GET /internal/stats/by-user - Usage broken down per team member, attributed
// via api_key.created_by (the person who provisioned the key). Only counts
// keys explicitly marked usageType = "personal" — most keys are provisioned
// by a single admin on behalf of an automated service, so including
// "service" keys here would misattribute their cost to whoever happened to
// click "create". Service-key spend is already visible in /stats/by-consumer.
const getUserStatsRoute = createRoute({
	operationId: "internal_get_stats_by_user",
	summary: "Get usage stats broken down by team member",
	description: `Returns request counts, error counts, and cost per team member for personal-use API keys only (keys marked usageType = "personal", attributed via the key's creator) for the last N days (default ${DEFAULT_STATS_WINDOW_DAYS}, max ${MAX_STATS_WINDOW_DAYS}, via the \`days\` query param). Service/automation keys are excluded here — see /stats/by-consumer for those. Requires a Bearer token matching INTERNAL_STATS_TOKEN.`,
	method: "get",
	path: "/stats/by-user",
	request: {
		query: statsQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: userStatsResponseSchema,
				},
			},
			description: "Usage totals per team member",
		},
	},
});

internalStats.openapi(getUserStatsRoute, async (c) => {
	requireInternalStatsToken(c.req.header("Authorization"));

	const { days } = c.req.valid("query");
	const windowDays = days ?? DEFAULT_STATS_WINDOW_DAYS;
	const STATS_WINDOW_MS = windowDays * 24 * 60 * 60 * 1000;
	const since = new Date(Date.now() - STATS_WINDOW_MS);

	const rows = await db
		.select({
			userId: apiKey.createdBy,
			name: user.name,
			email: user.email,
			apiKeyCount:
				sql<number>`COUNT(DISTINCT ${apiKeyHourlyStats.apiKeyId})`.as(
					"apiKeyCount",
				),
			requests:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"requests",
				),
			errors: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
				"errors",
			),
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
		})
		.from(apiKeyHourlyStats)
		.innerJoin(apiKey, eq(apiKeyHourlyStats.apiKeyId, apiKey.id))
		.innerJoin(user, eq(apiKey.createdBy, user.id))
		.where(
			and(
				gte(apiKeyHourlyStats.hourTimestamp, since),
				eq(apiKey.usageType, "personal"),
			),
		)
		.groupBy(apiKey.createdBy, user.name, user.email)
		.orderBy(desc(sql`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`));

	return c.json({
		users: rows.map((row) => ({
			userId: row.userId,
			name: row.name,
			email: row.email,
			apiKeyCount: Number(row.apiKeyCount),
			requests: Number(row.requests),
			errors: Number(row.errors),
			cost: Number(row.cost),
		})),
	});
});
