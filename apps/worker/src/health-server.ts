import { createServer, type Server } from "node:http";

import { logger } from "@llmgateway/logger";

/**
 * Minimal HTTP server satisfying Cloud Run's container runtime contract.
 *
 * The worker is a pure background consumer (Redis log/billing queue, hourly
 * stats aggregation, etc.) with no request-driven work of its own, but Cloud
 * Run (fully managed) services -- unlike worker pools, which were only
 * available as an alpha gcloud surface at the time this was written -- still
 * require the ingress container to bind `$PORT` and respond to the platform's
 * startup/liveness TCP probe, or the revision never becomes Ready and the
 * deploy hangs in a crash loop. This exists solely to satisfy that contract;
 * it carries no traffic (`run.googleapis.com/ingress: internal`, no
 * `allUsers` invoker binding) and reports readiness based on whether
 * `startWorker()` has finished dispatching its background loops.
 */
export interface HealthServer {
	server: Server;
	setReady: (ready: boolean) => void;
}

export function createHealthServer(): HealthServer {
	let ready = false;

	const server = createServer((req, res) => {
		if (req.url === "/health" || req.url === "/") {
			res.writeHead(ready ? 200 : 503, {
				"content-type": "application/json",
			});
			res.end(JSON.stringify({ status: ready ? "ok" : "starting" }));
			return;
		}
		res.writeHead(404);
		res.end();
	});

	server.on("error", (error) => {
		logger.warn(
			"Health check server error",
			error instanceof Error ? error : new Error(String(error)),
		);
	});

	return {
		server,
		setReady(value: boolean) {
			ready = value;
		},
	};
}
