import { runTcsTierRoutingChecks } from "@llmgateway/actions";
import { logger } from "@llmgateway/logger";

const LOCK_KEY = "tcs_tier_routing_checks";

function isTierChecksEnabled(): boolean {
	return process.env.TCS_TIER_CHECK_ENABLED === "true";
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

	if (!isTierChecksEnabled()) {
		logger.info(
			"TCS tier routing checks loop disabled (TCS_TIER_CHECK_ENABLED != true)",
		);
		deps.unregisterLoop();
		return;
	}

	logger.info(
		`Starting TCS tier routing checks loop (interval: ${intervalMs / 1000} seconds)...`,
	);

	try {
		while (!deps.shouldStop()) {
			try {
				const lockAcquired = await deps.acquireLock(LOCK_KEY);
				if (lockAcquired) {
					try {
						const summary = await runTcsTierRoutingChecks();
						if (!summary.ran) {
							logger.warn("TCS tier routing checks did not run", {
								reason: summary.reason,
							});
						}
					} finally {
						await deps.releaseLock(LOCK_KEY);
					}
				}

				if (!deps.shouldStop()) {
					await deps.interruptibleSleep(intervalMs);
				}
			} catch (error) {
				logger.warn(
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
