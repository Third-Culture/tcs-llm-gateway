import { afterEach, describe, expect, test } from "vitest";

import { createHealthServer } from "./health-server.js";

describe("health-server", () => {
	let closeServer: (() => void) | undefined;

	afterEach(() => {
		closeServer?.();
		closeServer = undefined;
	});

	async function listen() {
		const health = createHealthServer();
		await new Promise<void>((resolve) => {
			health.server.listen(0, "127.0.0.1", resolve);
		});
		const address = health.server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected server to bind to a port");
		}
		closeServer = () => health.server.close();
		return { health, port: address.port };
	}

	test("reports 503/starting before setReady(true)", async () => {
		const { port } = await listen();

		const res = await fetch(`http://127.0.0.1:${port}/health`);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ status: "starting" });
	});

	test("reports 200/ok after setReady(true)", async () => {
		const { health, port } = await listen();
		health.setReady(true);

		const res = await fetch(`http://127.0.0.1:${port}/health`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("serves the same status on / as on /health", async () => {
		const { health, port } = await listen();
		health.setReady(true);

		const res = await fetch(`http://127.0.0.1:${port}/`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("can flip back to unready (e.g. during shutdown)", async () => {
		const { health, port } = await listen();
		health.setReady(true);
		health.setReady(false);

		const res = await fetch(`http://127.0.0.1:${port}/health`);
		expect(res.status).toBe(503);
	});

	test("404s on unknown paths", async () => {
		const { port } = await listen();

		const res = await fetch(`http://127.0.0.1:${port}/unknown`);
		expect(res.status).toBe(404);
	});
});
