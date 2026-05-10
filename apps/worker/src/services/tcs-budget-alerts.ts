import { Decimal } from "decimal.js";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

/**
 * TCS-specific budget threshold alerts for per-API-key period usage limits.
 *
 * The upstream llmgateway already tracks `currentPeriodUsage` against
 * `periodUsageLimit` for each API key. This module layers alerting on top:
 * when usage crosses 80% or 100% of the configured budget for the current
 * period, it posts a message to Slack (and optionally opens a Linear issue)
 * so the TCS team can react before a service hits its hard limit.
 *
 * All outbound traffic is best-effort and fully gated on environment
 * variables; if no webhook/Linear credentials are configured the alerts are
 * written to structured logs only.
 *
 * Dedupe: each (apiKeyId, periodStartedAt, threshold) triple is recorded
 * once in Redis with a TTL of 40 days (longer than any plausible monthly
 * period). SET NX ensures only the first worker to cross the threshold
 * fires the alert.
 */

const DEDUPE_TTL_SECONDS = 40 * 24 * 60 * 60;

/** Ordered ascending so we emit the 80% alert before a subsequent tick can cross 100%. */
const THRESHOLDS = [0.8, 1.0] as const;
type Threshold = (typeof THRESHOLDS)[number];

const thresholdLabel: Record<Threshold, string> = {
	0.8: "80% (warning)",
	1.0: "100% (exceeded)",
};

export interface TcsBudgetAlertContext {
	apiKeyId: string;
	apiKeyDescription: string;
	projectId: string;
	organizationId: string;
	periodStartedAt: Date;
	periodUsageLimit: string;
	previousUsage: string;
	newUsage: string;
	durationValue: number;
	durationUnit: string;
}

/**
 * Determine which thresholds were crossed between previousUsage and newUsage
 * for the current period, then fire alerts for those thresholds (deduped via
 * Redis). Safe to call unconditionally after every usage update — a no-op if
 * no threshold was crossed or if the API key has no configured budget.
 */
export async function checkBudgetThresholds(
	ctx: TcsBudgetAlertContext,
): Promise<void> {
	if (!ctx.periodUsageLimit) {
		return;
	}

	const limit = new Decimal(ctx.periodUsageLimit);
	if (limit.lte(0)) {
		return;
	}

	const prev = new Decimal(ctx.previousUsage || "0");
	const next = new Decimal(ctx.newUsage || "0");
	if (next.lte(prev)) {
		return;
	}

	const prevRatio = prev.div(limit).toNumber();
	const nextRatio = next.div(limit).toNumber();

	for (const threshold of THRESHOLDS) {
		if (prevRatio >= threshold || nextRatio < threshold) {
			continue;
		}
		await fireAlert(ctx, threshold, nextRatio).catch((err) => {
			logger.error("tcs-budget-alert dispatch failed", err, {
				apiKeyId: ctx.apiKeyId,
				threshold,
			});
		});
	}
}

async function fireAlert(
	ctx: TcsBudgetAlertContext,
	threshold: Threshold,
	ratio: number,
): Promise<void> {
	const dedupeKey = `tcs:budget-alert:${ctx.apiKeyId}:${ctx.periodStartedAt.toISOString()}:${threshold}`;

	const claimed = await redisClient.set(
		dedupeKey,
		"1",
		"EX",
		DEDUPE_TTL_SECONDS,
		"NX",
	);
	if (claimed !== "OK") {
		return;
	}

	const payload = {
		apiKeyId: ctx.apiKeyId,
		apiKeyDescription: ctx.apiKeyDescription,
		projectId: ctx.projectId,
		organizationId: ctx.organizationId,
		threshold: thresholdLabel[threshold],
		usage: ctx.newUsage,
		limit: ctx.periodUsageLimit,
		usageRatio: ratio,
		periodStartedAt: ctx.periodStartedAt.toISOString(),
		periodDuration: `${ctx.durationValue} ${ctx.durationUnit}`,
	};

	logger.warn(
		`TCS budget alert: API key ${ctx.apiKeyDescription} crossed ${thresholdLabel[threshold]} of its ${payload.periodDuration} budget`,
		payload,
	);

	await Promise.all([postToSlack(payload), postToLinear(payload)]);
}

interface AlertPayload {
	apiKeyId: string;
	apiKeyDescription: string;
	projectId: string;
	organizationId: string;
	threshold: string;
	usage: string;
	limit: string;
	usageRatio: number;
	periodStartedAt: string;
	periodDuration: string;
}

async function postToSlack(payload: AlertPayload): Promise<void> {
	const webhookUrl = process.env.TCS_SLACK_BUDGET_WEBHOOK_URL;
	if (!webhookUrl) {
		return;
	}

	const text = [
		`*LLM gateway budget alert* — threshold ${payload.threshold}`,
		`API key: \`${payload.apiKeyDescription}\` (id \`${payload.apiKeyId}\`)`,
		`Usage: $${payload.usage} / $${payload.limit} (${(payload.usageRatio * 100).toFixed(1)}%)`,
		`Period: ${payload.periodDuration} starting ${payload.periodStartedAt}`,
		`Project: \`${payload.projectId}\` · Org: \`${payload.organizationId}\``,
	].join("\n");

	try {
		const res = await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});
		if (!res.ok) {
			logger.warn("Slack webhook non-OK response", {
				status: res.status,
				apiKeyId: payload.apiKeyId,
			});
		}
	} catch (err) {
		logger.error("Slack webhook post failed", err, {
			apiKeyId: payload.apiKeyId,
		});
	}
}

async function postToLinear(payload: AlertPayload): Promise<void> {
	const apiKey = process.env.TCS_LINEAR_API_KEY;
	const teamId = process.env.TCS_LINEAR_BUDGET_TEAM_ID;
	if (!apiKey || !teamId) {
		return;
	}

	const title = `LLM gateway budget ${payload.threshold} on ${payload.apiKeyDescription}`;
	const description = [
		`API key: \`${payload.apiKeyDescription}\` (id \`${payload.apiKeyId}\`)`,
		"",
		`- Usage: $${payload.usage} / $${payload.limit} (${(payload.usageRatio * 100).toFixed(1)}%)`,
		`- Period: ${payload.periodDuration} starting ${payload.periodStartedAt}`,
		`- Project: \`${payload.projectId}\``,
		`- Organization: \`${payload.organizationId}\``,
	].join("\n");

	const mutation = `
		mutation CreateBudgetIssue($input: IssueCreateInput!) {
			issueCreate(input: $input) { success issue { id identifier } }
		}
	`;

	try {
		const res = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: apiKey,
			},
			body: JSON.stringify({
				query: mutation,
				variables: { input: { teamId, title, description } },
			}),
		});
		if (!res.ok) {
			logger.warn("Linear issueCreate non-OK response", {
				status: res.status,
				apiKeyId: payload.apiKeyId,
			});
		}
	} catch (err) {
		logger.error("Linear issueCreate failed", err, {
			apiKeyId: payload.apiKeyId,
		});
	}
}
