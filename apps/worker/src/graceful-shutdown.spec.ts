import { describe, expect, it, vi } from "vitest";

import {
	interruptibleDelay,
	runPollingLoop,
	type PollingLoopDeps,
} from "./worker.js";

/**
 * Regression tests for the recurring `llmgateway-worker` `log_error` alert.
 *
 * Root cause: the worker's polling loops used a raw, non-interruptible
 * `setTimeout` for their between-iteration waits. Loops with intervals longer
 * than `stopWorker`'s 15s graceful-stop budget (auto top-up 120s, data
 * retention 300s, project stats 60s) would, on `SIGTERM`, keep `activeLoops`
 * above zero until the full interval elapsed. `stopWorker` then hit its timeout
 * and emitted `logger.error("Timeout reached ... Worker stop failed")` —
 * severity=ERROR — on essentially every Cloud Run revision rollout / scale-in,
 * firing the raw `severity>=ERROR` log-based alert. PR #13 only downgraded
 * operational loop logs to `warn` and never touched this shutdown path, which is
 * why the alert kept recurring.
 *
 * The fix routes every polling loop through `runPollingLoop`, whose waits use
 * `interruptibleSleep`, so a stop request is observed within one sleep chunk
 * regardless of the interval. These tests would time out (loop blocks for the
 * full interval) against the pre-fix behaviour.
 */

function makeDeps(stopRef: { stop: boolean }): PollingLoopDeps & {
	active: () => number;
} {
	let active = 0;
	return {
		shouldStop: () => stopRef.stop,
		registerLoop: () => {
			active++;
		},
		unregisterLoop: () => {
			active--;
		},
		interruptibleSleep: (ms) => interruptibleDelay(ms, () => stopRef.stop, 25),
		active: () => active,
	};
}

describe("interruptibleDelay", () => {
	it("resolves promptly when the stop predicate flips mid-sleep", async () => {
		let stop = false;
		setTimeout(() => {
			stop = true;
		}, 60);

		const start = Date.now();
		await interruptibleDelay(60_000, () => stop, 25);
		expect(Date.now() - start).toBeLessThan(1000);
	});

	it("sleeps for the full duration when never stopped", async () => {
		const start = Date.now();
		await interruptibleDelay(150, () => false, 25);
		expect(Date.now() - start).toBeGreaterThanOrEqual(120);
	});

	it("returns immediately when already stopped", async () => {
		const start = Date.now();
		await interruptibleDelay(60_000, () => true, 25);
		expect(Date.now() - start).toBeLessThan(100);
	});
});

describe("runPollingLoop graceful shutdown", () => {
	it("exits within the stop budget even with a long interval", async () => {
		const stopRef = { stop: false };
		const deps = makeDeps(stopRef);
		const task = vi.fn().mockResolvedValue(undefined);

		// 300s mirrors the data-retention loop interval in production.
		const loop = runPollingLoop(
			{ name: "test", intervalMs: 300_000, task },
			deps,
		);

		// Let the first iteration run and enter the long interval sleep.
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(deps.active()).toBe(1);
		expect(task).toHaveBeenCalledTimes(1);

		stopRef.stop = true;
		const start = Date.now();
		await loop;

		// Pre-fix this would take ~300s; post-fix it exits within a sleep chunk.
		expect(Date.now() - start).toBeLessThan(2000);
		// Loop deregistered -> stopWorker's activeLoops counter reaches 0 in time.
		expect(deps.active()).toBe(0);
	});

	it("does not start another wait when stop is requested during the task", async () => {
		const stopRef = { stop: false };
		const deps = makeDeps(stopRef);
		const task = vi.fn().mockImplementation(async () => {
			stopRef.stop = true;
		});

		const start = Date.now();
		await runPollingLoop({ name: "test", intervalMs: 300_000, task }, deps);

		expect(Date.now() - start).toBeLessThan(1000);
		expect(task).toHaveBeenCalledTimes(1);
		expect(deps.active()).toBe(0);
	});

	it("honors the stop request during the post-error backoff wait", async () => {
		const stopRef = { stop: false };
		const deps = makeDeps(stopRef);
		const task = vi.fn().mockRejectedValue(new Error("boom"));

		const loop = runPollingLoop(
			{ name: "test", intervalMs: 300_000, errorBackoffMs: 300_000, task },
			deps,
		);

		await new Promise((resolve) => setTimeout(resolve, 60));
		stopRef.stop = true;
		const start = Date.now();
		await loop;

		expect(Date.now() - start).toBeLessThan(2000);
		expect(deps.active()).toBe(0);
	});
});
