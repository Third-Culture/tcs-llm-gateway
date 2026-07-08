import { fileURLToPath } from "node:url";

import { logger } from "@llmgateway/logger";

import { createHealthServer } from "./health-server.js";
import { startWorker, stopWorker } from "./worker.js";

export { processLogQueue } from "./worker.js";
export {
	processPendingVideoJobs,
	processPendingWebhookDeliveries,
} from "./services/video-jobs.js";

const PORT = Number(process.env.PORT) || 8080;
const health = createHealthServer();

let isShuttingDown = false;

async function gracefulShutdown(): Promise<void> {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;
	logger.info("Received shutdown signal, stopping worker...");

	health.setReady(false);
	health.server.close();

	try {
		await stopWorker();
		logger.info("Worker stopped gracefully");
		process.exit(0);
	} catch (error) {
		logger.error(
			"Error during graceful shutdown",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", error);
	void gracefulShutdown();
});

process.on("unhandledRejection", (reason) => {
	logger.error(
		"Unhandled promise rejection",
		reason instanceof Error ? reason : new Error(String(reason)),
	);
	void gracefulShutdown();
});

function isDirectExecution() {
	const entrypoint = process.argv[1];
	if (!entrypoint) {
		return false;
	}

	return fileURLToPath(import.meta.url) === entrypoint;
}

if (isDirectExecution()) {
	logger.info("Starting worker application...");

	health.server.listen(PORT, "0.0.0.0", () => {
		logger.info(`Health check server listening on port ${PORT}`);
	});

	startWorker()
		.then(() => {
			// startWorker() only awaits the initial provider/model sync before
			// dispatching its background loops (see startWorker in worker.ts) --
			// by the time this resolves, all loops are running, so it's a
			// reasonable readiness signal even though the loops themselves never
			// "complete".
			health.setReady(true);
		})
		.catch((error) => {
			logger.error(
				"Failed to start worker",
				error instanceof Error ? error : new Error(String(error)),
			);
			process.exit(1);
		});
}
