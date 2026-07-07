import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	getUserOrganizationIds,
	getUserProjectIds,
} from "@/utils/authorization.js";

import {
	db,
	sql,
	inArray,
	and,
	gte,
	lte,
	eq,
	desc,
	isNotNull,
	apiKey,
	apiKeyHourlyStats,
	user,
	log,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const activityBreakdown = new OpenAPIHono<ServerTypes>();

const timeRangeEnum = z.enum(["1h", "4h", "24h", "7d", "30d"]);

// Metadata keys are stored lowercase (see extractCustomHeaders), so only
// lowercase letters, digits, and hyphens are ever valid.
const metadataKeyPattern = /^[a-z0-9-]+$/;

interface DateRangeQuery {
	days?: number;
	from?: string;
	to?: string;
	timeRange?: z.infer<typeof timeRangeEnum>;
}

function resolveDateRange({ days, from, to, timeRange }: DateRangeQuery): {
	startDate: Date;
	endDate: Date;
} {
	if (timeRange) {
		const endDate = new Date();
		const startDate = new Date();
		switch (timeRange) {
			case "1h":
				startDate.setHours(startDate.getHours() - 1);
				break;
			case "4h":
				startDate.setHours(startDate.getHours() - 4);
				break;
			case "24h":
				startDate.setHours(startDate.getHours() - 24);
				break;
			case "7d":
				startDate.setDate(startDate.getDate() - 7);
				break;
			case "30d":
				startDate.setDate(startDate.getDate() - 30);
				break;
		}
		return { startDate, endDate };
	}

	if (from && to) {
		return {
			startDate: new Date(from + "T00:00:00"),
			endDate: new Date(to + "T23:59:59.999"),
		};
	}

	const effectiveDays = days ?? 7;
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - effectiveDays);
	return { startDate, endDate };
}

/**
 * Resolves the project scope for the current user: all of their accessible
 * projects, narrowed to a single project if `projectId` is provided and
 * accessible. Throws 403 if `projectId` is set but not accessible.
 */
async function resolveProjectScope(
	userId: string,
	projectId: string | undefined,
): Promise<string[]> {
	const organizationIds = await getUserOrganizationIds(userId);
	if (!organizationIds.length) {
		return [];
	}

	const accessibleProjectIds = await getUserProjectIds(userId);
	if (!accessibleProjectIds.length) {
		return [];
	}

	if (projectId) {
		if (!accessibleProjectIds.includes(projectId)) {
			throw new HTTPException(403, {
				message: "You don't have access to this project",
			});
		}
		return [projectId];
	}

	return accessibleProjectIds;
}

const breakdownRowSchema = z.object({
	key: z.string(),
	label: z.string(),
	secondaryLabel: z.string().optional(),
	requestCount: z.number(),
	cost: z.number(),
	errorCount: z.number(),
	cacheCount: z.number(),
	totalTokens: z.number(),
});

const breakdownResponseSchema = z.object({
	breakdown: z.array(breakdownRowSchema),
	totalCost: z.number(),
	totalRequests: z.number(),
});

const dateRangeQuerySchema = {
	days: z
		.string()
		.transform((val) => parseInt(val, 10))
		.pipe(z.number().int().positive())
		.optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	timeRange: timeRangeEnum.optional(),
	projectId: z.string().optional(),
};

// GET /activity/breakdown - "Who/what is spending" view. Groups the existing
// api_key_hourly_stats aggregation table either by API key ("apps &
// services") or by the team member who created the key ("users"). Both are
// zero-friction: they require no client-side opt-in and reuse data that's
// already being written by the stats aggregator worker.
const getBreakdown = createRoute({
	operationId: "get_activity_breakdown",
	summary: "Get usage breakdown by API key or by team member",
	method: "get",
	path: "/breakdown",
	request: {
		query: z.object({
			dimension: z.enum(["apiKey", "user"]),
			...dateRangeQuerySchema,
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: breakdownResponseSchema,
				},
			},
			description: "Usage totals grouped by API key or by team member",
		},
	},
});

activityBreakdown.openapi(getBreakdown, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { dimension, days, from, to, timeRange, projectId } =
		c.req.valid("query");
	const { startDate, endDate } = resolveDateRange({
		days,
		from,
		to,
		timeRange,
	});
	const projectIds = await resolveProjectScope(authUser.id, projectId);

	if (!projectIds.length) {
		return c.json({ breakdown: [], totalCost: 0, totalRequests: 0 });
	}

	const whereClause = and(
		inArray(apiKeyHourlyStats.projectId, projectIds),
		gte(apiKeyHourlyStats.hourTimestamp, startDate),
		lte(apiKeyHourlyStats.hourTimestamp, endDate),
	);

	const aggregates = {
		requestCount:
			sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
				"requestCount",
			),
		cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
		errorCount:
			sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
				"errorCount",
			),
		cacheCount:
			sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cacheCount}), 0)`.as(
				"cacheCount",
			),
		totalTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
				"totalTokens",
			),
	};

	const breakdown =
		dimension === "apiKey"
			? (
					await db
						.select({
							apiKeyId: apiKeyHourlyStats.apiKeyId,
							description: apiKey.description,
							status: apiKey.status,
							createdByName: user.name,
							createdByEmail: user.email,
							...aggregates,
						})
						.from(apiKeyHourlyStats)
						.innerJoin(apiKey, eq(apiKeyHourlyStats.apiKeyId, apiKey.id))
						.innerJoin(user, eq(apiKey.createdBy, user.id))
						.where(whereClause)
						.groupBy(
							apiKeyHourlyStats.apiKeyId,
							apiKey.description,
							apiKey.status,
							user.name,
							user.email,
						)
						.orderBy(desc(sql`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`))
				).map((row) => ({
					key: row.apiKeyId,
					label: row.description || "Untitled key",
					secondaryLabel:
						row.status === "deleted"
							? "Deleted key"
							: `Created by ${row.createdByName || row.createdByEmail}`,
					requestCount: Number(row.requestCount),
					cost: Number(row.cost),
					errorCount: Number(row.errorCount),
					cacheCount: Number(row.cacheCount),
					totalTokens: Number(row.totalTokens),
				}))
			: (
					await db
						.select({
							createdBy: apiKey.createdBy,
							createdByName: user.name,
							createdByEmail: user.email,
							apiKeyCount:
								sql<number>`COUNT(DISTINCT ${apiKeyHourlyStats.apiKeyId})`.as(
									"apiKeyCount",
								),
							...aggregates,
						})
						.from(apiKeyHourlyStats)
						.innerJoin(apiKey, eq(apiKeyHourlyStats.apiKeyId, apiKey.id))
						.innerJoin(user, eq(apiKey.createdBy, user.id))
						.where(whereClause)
						.groupBy(apiKey.createdBy, user.name, user.email)
						.orderBy(desc(sql`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`))
				).map((row) => {
					const keyCount = Number(row.apiKeyCount);
					return {
						key: row.createdBy,
						label: row.createdByName || row.createdByEmail,
						secondaryLabel: `${keyCount} API key${keyCount === 1 ? "" : "s"}`,
						requestCount: Number(row.requestCount),
						cost: Number(row.cost),
						errorCount: Number(row.errorCount),
						cacheCount: Number(row.cacheCount),
						totalTokens: Number(row.totalTokens),
					};
				});

	const totals = breakdown.reduce(
		(acc, r) => ({
			cost: acc.cost + r.cost,
			requests: acc.requests + r.requestCount,
		}),
		{ cost: 0, requests: 0 },
	);

	return c.json({
		breakdown,
		totalCost: totals.cost,
		totalRequests: totals.requests,
	});
});

const metadataBreakdownResponseSchema = z.object({
	breakdown: z.array(
		z.object({
			key: z.string(),
			requestCount: z.number(),
			cost: z.number(),
		}),
	),
	totalCost: z.number(),
	totalRequests: z.number(),
});

// GET /activity/breakdown/metadata - Advanced/optional lens: groups raw log
// rows by a customer-supplied X-LLMGateway-* header value (e.g. "user-id").
// Unlike /breakdown, this scans the log table directly since custom header
// values aren't pre-aggregated. Bounded by projectId + createdAt, which
// matches the existing log_project_id_created_at_idx index.
const getMetadataBreakdown = createRoute({
	operationId: "get_activity_breakdown_metadata",
	summary: "Get usage breakdown by a custom X-LLMGateway-* metadata header",
	method: "get",
	path: "/breakdown/metadata",
	request: {
		query: z.object({
			metadataKey: z.string().min(1).regex(metadataKeyPattern),
			...dateRangeQuerySchema,
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: metadataBreakdownResponseSchema,
				},
			},
			description: "Usage totals grouped by a custom metadata header value",
		},
	},
});

activityBreakdown.openapi(getMetadataBreakdown, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { metadataKey, days, from, to, timeRange, projectId } =
		c.req.valid("query");
	const { startDate, endDate } = resolveDateRange({
		days,
		from,
		to,
		timeRange,
	});
	const projectIds = await resolveProjectScope(authUser.id, projectId);

	if (!projectIds.length) {
		return c.json({ breakdown: [], totalCost: 0, totalRequests: 0 });
	}

	// The header value is extracted once in a subquery and grouped on as a
	// plain column in the outer query. Grouping directly on a repeated
	// `customHeaders ->> $metadataKey` expression fails in Postgres because
	// each interpolation binds its own parameter, so the SELECT and GROUP BY
	// expressions aren't recognized as identical even though the value is.
	const taggedLogs = db
		.select({
			key: sql<string>`${log.customHeaders} ->> ${metadataKey}`.as("key"),
			cost: log.cost,
		})
		.from(log)
		.where(
			and(
				inArray(log.projectId, projectIds),
				gte(log.createdAt, startDate),
				lte(log.createdAt, endDate),
			),
		)
		.as("tagged_logs");

	const rows = await db
		.select({
			key: taggedLogs.key,
			requestCount: sql<number>`COUNT(*)`.as("requestCount"),
			cost: sql<number>`COALESCE(SUM(${taggedLogs.cost}), 0)`.as("cost"),
		})
		.from(taggedLogs)
		.where(isNotNull(taggedLogs.key))
		.groupBy(taggedLogs.key)
		.orderBy(desc(sql`COALESCE(SUM(${taggedLogs.cost}), 0)`))
		.limit(25);

	const breakdown = rows.map((row) => ({
		key: row.key as string,
		requestCount: Number(row.requestCount),
		cost: Number(row.cost),
	}));

	const totals = breakdown.reduce(
		(acc, r) => ({
			cost: acc.cost + r.cost,
			requests: acc.requests + r.requestCount,
		}),
		{ cost: 0, requests: 0 },
	);

	return c.json({
		breakdown,
		totalCost: totals.cost,
		totalRequests: totals.requests,
	});
});

const metadataKeysResponseSchema = z.object({
	keys: z.array(z.string()),
});

// GET /activity/breakdown/metadata-keys - Discovers which X-LLMGateway-*
// metadata keys a project has actually sent in the last 30 days, so the UI
// can offer a picker instead of guessing, or show an onboarding empty state
// (pointing at the X-LLMGateway-User-ID convention) when none exist yet.
const getMetadataKeys = createRoute({
	operationId: "get_activity_breakdown_metadata_keys",
	summary: "List custom metadata header keys seen for a project",
	method: "get",
	path: "/breakdown/metadata-keys",
	request: {
		query: z.object({
			projectId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: metadataKeysResponseSchema,
				},
			},
			description: "Distinct metadata header keys sent in the last 30 days",
		},
	},
});

activityBreakdown.openapi(getMetadataKeys, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.valid("query");
	const projectIds = await resolveProjectScope(authUser.id, projectId);

	if (!projectIds.length) {
		return c.json({ keys: [] });
	}

	const since = new Date();
	since.setDate(since.getDate() - 30);

	// json_object_keys is a set-returning function: each matching log row
	// expands into one row per header key it has. The surrounding scan is
	// still bounded by the project + createdAt index, and the outer limit
	// caps the total rows considered for key discovery.
	const rows = await db
		.select({
			key: sql<string>`json_object_keys(${log.customHeaders})`.as("key"),
		})
		.from(log)
		.where(
			and(
				inArray(log.projectId, projectIds),
				gte(log.createdAt, since),
				isNotNull(log.customHeaders),
			),
		)
		.orderBy(desc(log.createdAt))
		.limit(2000);

	const keys = Array.from(new Set(rows.map((row) => row.key))).sort();

	return c.json({ keys });
});
