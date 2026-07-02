import { redisClient } from "@llmgateway/cache";
import { db, eq, tcsTierRoutingStatus } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { listTcsRoutingTiers } from "@llmgateway/models";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";

const LOCK_KEY = "tcs_tier_routing_checks";
const ALERT_DEDUPE_TTL_SECONDS = 55 * 60;

interface TierCheckResult {
	tierId: string;
	status: "ok" | "error";
	selectedProvider?: string;
	selectedModel?: string;
	latencyMs: number;
	error?: string;
}

interface ChatCompletionProbeResponse {
	choices?: Array<{ message?: { content?: string } }>;
	metadata?: {
		used_provider?: string;
		underlying_used_model?: string;
		used_model?: string;
	};
	error?: { message?: string };
}

function isTierChecksEnabled(): boolean {
	return process.env.TCS_TIER_CHECK_ENABLED === "true";
}

function getGatewayUrl(): string {
	return (
		process.env.TCS_TIER_CHECK_GATEWAY_URL?.replace(/\/$/, "") ??
		"http://localhost:4001"
	);
}

function getGatewayApiKey(): string | undefined {
	return process.env.TCS_TIER_CHECK_API_KEY;
}

function getAlertEmails(): string[] {
	const configured = process.env.TCS_TIER_CHECK_ALERT_EMAILS;
	if (configured) {
		return configured
			.split(",")
			.map((email) => email.trim())
			.filter(Boolean);
	}

	const adminEmails = process.env.ADMIN_EMAILS ?? "";
	return adminEmails
		.split(",")
		.map((email) => email.trim())
		.filter(Boolean);
}

async function probeTier(
	tierId: string,
	apiKey: string,
): Promise<TierCheckResult> {
	const startedAt = Date.now();
	const gatewayUrl = getGatewayUrl();

	try {
		const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: tierId,
				max_tokens: 16,
				response_format: { type: "json_object" },
				messages: [
					{
						role: "user",
						content: 'Reply with JSON only: {"ok":true}',
					},
				],
			}),
			signal: AbortSignal.timeout(
				Number(process.env.TCS_TIER_CHECK_TIMEOUT_MS ?? "60000"),
			),
		});

		const latencyMs = Date.now() - startedAt;
		const body = (await response.json()) as ChatCompletionProbeResponse;

		if (!response.ok) {
			return {
				tierId,
				status: "error",
				latencyMs,
				error:
					body.error?.message ??
					`Gateway returned HTTP ${response.status} for tier ${tierId}`,
			};
		}

		const content = body.choices?.[0]?.message?.content;
		if (!content) {
			return {
				tierId,
				status: "error",
				latencyMs,
				error: "Gateway response did not include message content",
			};
		}

		const selectedProvider = body.metadata?.used_provider;
		const selectedModel =
			body.metadata?.underlying_used_model ?? body.metadata?.used_model;

		if (!selectedProvider || !selectedModel) {
			return {
				tierId,
				status: "error",
				latencyMs,
				error: "Gateway response did not include routing metadata",
			};
		}

		return {
			tierId,
			status: "ok",
			selectedProvider,
			selectedModel,
			latencyMs,
		};
	} catch (error) {
		return {
			tierId,
			status: "error",
			latencyMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function sendFailureEmail(opts: {
	tierId: string;
	tierName: string;
	error: string;
	selectedProvider?: string;
	selectedModel?: string;
}): Promise<void> {
	const recipients = getAlertEmails();
	if (recipients.length === 0) {
		logger.warn("TCS tier routing alert skipped: no alert emails configured", {
			tierId: opts.tierId,
		});
		return;
	}

	const client = getResendClient();
	if (!client) {
		logger.error(
			"RESEND_API_KEY is not configured. TCS tier routing alert will not be sent.",
			new Error(`Resend not configured for tier alert: ${opts.tierId}`),
		);
		return;
	}

	const subject = `TCS tier routing check failed: ${opts.tierName}`;
	const text = [
		`The hourly routing health check failed for tier "${opts.tierName}" (${opts.tierId}).`,
		"",
		`Error: ${opts.error}`,
		opts.selectedProvider
			? `Last routed provider: ${opts.selectedProvider}`
			: "No provider was selected.",
		opts.selectedModel ? `Last routed model: ${opts.selectedModel}` : null,
		"",
		`Gateway: ${getGatewayUrl()}`,
		`Checked at: ${new Date().toISOString()}`,
	]
		.filter(Boolean)
		.join("\n");

	for (const to of recipients) {
		const { error } = await client.emails.send({
			from: fromEmail,
			to: [to],
			replyTo: replyToEmail,
			subject,
			text,
		});

		if (error) {
			throw new Error(`Resend API error for ${to}: ${error.message}`);
		}
	}

	logger.warn("TCS tier routing failure alert sent", {
		tierId: opts.tierId,
		recipients,
	});
}

async function maybeSendFailureAlert(opts: {
	tierId: string;
	tierName: string;
	previousStatus?: string;
	result: TierCheckResult;
}): Promise<void> {
	if (opts.result.status !== "error") {
		return;
	}

	const shouldAlert =
		opts.previousStatus === undefined || opts.previousStatus === "ok";
	if (!shouldAlert) {
		return;
	}

	const dedupeKey = `tcs:tier-routing-alert:${opts.tierId}`;
	const claimed = await redisClient.set(
		dedupeKey,
		"1",
		"EX",
		ALERT_DEDUPE_TTL_SECONDS,
		"NX",
	);
	if (claimed !== "OK") {
		return;
	}

	await sendFailureEmail({
		tierId: opts.tierId,
		tierName: opts.tierName,
		error: opts.result.error ?? "Unknown error",
		selectedProvider: opts.result.selectedProvider,
		selectedModel: opts.result.selectedModel,
	});
}

export async function runTcsTierRoutingChecks(): Promise<void> {
	if (!isTierChecksEnabled()) {
		logger.info(
			"TCS tier routing checks disabled (TCS_TIER_CHECK_ENABLED != true)",
		);
		return;
	}

	const apiKey = getGatewayApiKey();
	if (!apiKey) {
		logger.warn(
			"TCS tier routing checks skipped: TCS_TIER_CHECK_API_KEY is not set",
		);
		return;
	}

	const tiers = listTcsRoutingTiers();
	const checkedAt = new Date();

	for (const tier of tiers) {
		const existingRows = await db
			.select()
			.from(tcsTierRoutingStatus)
			.where(eq(tcsTierRoutingStatus.tierId, tier.id))
			.limit(1);
		const existing = existingRows[0];

		const result = await probeTier(tier.id, apiKey);
		const fallbackProviders = tier.providers.slice(1);

		await db
			.insert(tcsTierRoutingStatus)
			.values({
				tierId: tier.id,
				tierName: tier.name,
				status: result.status,
				selectedProvider: result.selectedProvider ?? null,
				selectedModel: result.selectedModel ?? null,
				primaryProvider: tier.primaryProvider,
				primaryModel: tier.primaryModel,
				fallbackProviders,
				lastCheckedAt: checkedAt,
				lastSuccessAt:
					result.status === "ok" ? checkedAt : existing?.lastSuccessAt,
				lastError: result.status === "error" ? (result.error ?? null) : null,
				latencyMs: result.latencyMs,
			})
			.onConflictDoUpdate({
				target: tcsTierRoutingStatus.tierId,
				set: {
					tierName: tier.name,
					status: result.status,
					selectedProvider: result.selectedProvider ?? null,
					selectedModel: result.selectedModel ?? null,
					primaryProvider: tier.primaryProvider,
					primaryModel: tier.primaryModel,
					fallbackProviders,
					lastCheckedAt: checkedAt,
					lastSuccessAt:
						result.status === "ok" ? checkedAt : existing?.lastSuccessAt,
					lastError: result.status === "error" ? (result.error ?? null) : null,
					latencyMs: result.latencyMs,
					updatedAt: new Date(),
				},
			});

		await maybeSendFailureAlert({
			tierId: tier.id,
			tierName: tier.name,
			previousStatus: existing?.status,
			result,
		});

		logger.info("TCS tier routing check completed", {
			tierId: tier.id,
			status: result.status,
			selectedProvider: result.selectedProvider,
			selectedModel: result.selectedModel,
			latencyMs: result.latencyMs,
		});
	}
}

export async function runTcsTierRoutingChecksLoop(deps: {
	shouldStop: () => boolean;
	acquireLock: (key: string) => Promise<boolean>;
	releaseLock: (key: string) => Promise<void>;
	interruptibleSleep: (ms: number) => Promise<void>;
	registerLoop: () => void;
	unregisterLoop: () => void;
}): Promise<void> {
	deps.registerLoop();

	const intervalMs =
		Number(process.env.TCS_TIER_CHECK_INTERVAL_SECONDS ?? "3600") * 1000;

	logger.info(
		`Starting TCS tier routing checks loop (interval: ${intervalMs / 1000} seconds)...`,
	);

	try {
		while (!deps.shouldStop()) {
			try {
				const lockAcquired = await deps.acquireLock(LOCK_KEY);
				if (lockAcquired) {
					try {
						await runTcsTierRoutingChecks();
					} finally {
						await deps.releaseLock(LOCK_KEY);
					}
				}

				if (!deps.shouldStop()) {
					await deps.interruptibleSleep(intervalMs);
				}
			} catch (error) {
				logger.error(
					"Error in TCS tier routing checks loop",
					error instanceof Error ? error : new Error(String(error)),
				);
				if (!deps.shouldStop()) {
					await deps.interruptibleSleep(30000);
				}
			}
		}
	} finally {
		deps.unregisterLoop();
		logger.info("TCS tier routing checks loop stopped");
	}
}
