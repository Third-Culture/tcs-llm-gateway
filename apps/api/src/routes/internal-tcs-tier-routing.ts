import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { requireInternalStatsToken } from "@/utils/internal-auth.js";

import {
	getTcsTierRoutingStatusSnapshot,
	runTcsTierRoutingChecks,
} from "@llmgateway/actions";

import type { ServerTypes } from "@/vars.js";

export const internalTcsTierRouting = new OpenAPIHono<ServerTypes>();

const tcsTierProviderMappingSchema = z.object({
	providerId: z.string(),
	modelName: z.string(),
});

const tcsTierRoutingStatusSchema = z.object({
	tierId: z.string(),
	tierName: z.string(),
	description: z.string().optional(),
	status: z.enum(["ok", "error", "unknown"]),
	selectedProvider: z.string().nullable(),
	selectedModel: z.string().nullable(),
	primaryProvider: z.string(),
	primaryModel: z.string(),
	fallbackProviders: z.array(tcsTierProviderMappingSchema),
	lastCheckedAt: z.string().nullable(),
	lastSuccessAt: z.string().nullable(),
	lastError: z.string().nullable(),
	latencyMs: z.number().nullable(),
});

const tcsTierRoutingStatusResponseSchema = z.object({
	tiers: z.array(tcsTierRoutingStatusSchema),
	checkedAt: z.string().nullable(),
});

// GET /internal/tcs-tier-routing-status - Current health status of every
// `tcs-*` virtual model tier, used by internal tools (e.g. the llm-admin
// chat UI's Routing tab). Requires a Bearer token matching
// INTERNAL_STATS_TOKEN, same as /internal/stats.
const getTcsTierRoutingStatusRoute = createRoute({
	operationId: "internal_get_tcs_tier_routing_status",
	summary: "Get TCS tier routing health status",
	description:
		"Returns the last recorded routing/health status for every tcs-* virtual model tier. Requires a Bearer token matching INTERNAL_STATS_TOKEN.",
	method: "get",
	path: "/tcs-tier-routing-status",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: tcsTierRoutingStatusResponseSchema,
				},
			},
			description: "Current TCS tier routing health status",
		},
	},
});

internalTcsTierRouting.openapi(getTcsTierRoutingStatusRoute, async (c) => {
	requireInternalStatsToken(c.req.header("Authorization"));
	const snapshot = await getTcsTierRoutingStatusSnapshot();
	return c.json(snapshot);
});

// POST /internal/tcs-tier-routing-status/run - Triggers an immediate,
// synchronous check of every tier instead of waiting for the worker's
// hourly loop, used by the llm-admin "Run check now" button.
const runTcsTierRoutingStatusRoute = createRoute({
	operationId: "internal_run_tcs_tier_routing_status",
	summary: "Run TCS tier routing health check now",
	description:
		"Probes every tcs-* virtual model tier immediately and returns the updated status. Requires a Bearer token matching INTERNAL_STATS_TOKEN.",
	method: "post",
	path: "/tcs-tier-routing-status/run",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: tcsTierRoutingStatusResponseSchema.extend({
						ran: z.boolean(),
						reason: z.string().optional(),
					}),
				},
			},
			description: "Result of an on-demand TCS tier routing health check",
		},
	},
});

internalTcsTierRouting.openapi(runTcsTierRoutingStatusRoute, async (c) => {
	requireInternalStatsToken(c.req.header("Authorization"));
	const summary = await runTcsTierRoutingChecks();
	const snapshot = await getTcsTierRoutingStatusSnapshot();
	return c.json({
		...snapshot,
		ran: summary.ran,
		reason: summary.reason,
	});
});
