import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { requireInternalStatsToken } from "@/utils/internal-auth.js";

import {
	getTcsTierRoutingStatusSnapshot,
	runTcsTierRoutingChecks,
} from "@llmgateway/actions";

export const internalTcsTierRouting = new OpenAPIHono();

const tcsTierProviderMappingSchema = z.object({
	providerId: z.string(),
	modelName: z.string(),
});

const tcsTierVerifiedPricingSchema = z.object({
	providerId: z.string(),
	modelName: z.string(),
	inputPricePerMillion: z.number(),
	outputPricePerMillion: z.number(),
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
	verifiedPricing: tcsTierVerifiedPricingSchema.nullable(),
	primaryPricing: tcsTierVerifiedPricingSchema.nullable(),
});

const tcsTierRoutingStatusResponseSchema = z.object({
	tiers: z.array(tcsTierRoutingStatusSchema),
	checkedAt: z.string().nullable(),
});

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
