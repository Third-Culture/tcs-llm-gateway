import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AddressInfo } from "net";
import type { Server } from "node:http";

const REQUIRED_ENV = {
	GOOGLE_CLIENT_ID: "test-google-client-id",
	SESSION_SECRET: "test-session-secret",
	LLM_API_KEY: "test-llm-api-key",
};

function setRequiredEnv(): void {
	process.env.NODE_ENV = "test";
	for (const [key, value] of Object.entries(REQUIRED_ENV)) {
		process.env[key] = value;
	}
}

async function freshServerModule() {
	vi.resetModules();
	setRequiredEnv();
	return await import("./server.js");
}

describe("llm-admin server", () => {
	const originalEnv = { ...process.env };
	let server: Server | null = null;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve) => server!.close(() => resolve()));
			server = null;
		}
		vi.unstubAllGlobals();
	});

	test("GET /health reports ok when required config is present", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/health`);
		const body = (await res.json()) as { status: string; service: string };

		expect(res.status).toBe(200);
		expect(body.status).toBe("ok");
		expect(body.service).toBe("llm-admin");
	});

	test("GET /api/stats requires authentication", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
		expect(res.status).toBe(401);
	});

	test("fetchGatewayStats returns a note when LLM_INTERNAL_TOKEN is unset", async () => {
		delete process.env.LLM_INTERNAL_TOKEN;
		const { fetchGatewayStats } = await freshServerModule();

		const stats = await fetchGatewayStats();

		expect(stats).toEqual({
			days: [],
			totals: { requests: 0, errors: 0, cost: 0 },
			note: "LLM_INTERNAL_TOKEN not configured",
		});
	});

	test("fetchGatewayStats forwards the upstream payload on success", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = {
			totals: { requests: 42, errors: 1, cost: 3.14 },
			days: [{ day: "2026-07-01", requests: 42 }],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(url).toBe("http://internal.example/internal/stats?days=30");
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-internal-token",
				);
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { fetchGatewayStats } = await freshServerModule();
		const stats = await fetchGatewayStats();

		expect(stats).toEqual(upstreamBody);
	});

	test("fetchGatewayStats forwards a custom days window", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = {
			totals: { requests: 100, errors: 2, cost: 9.5 },
			days: [{ day: "2026-06-01", requests: 100 }],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				expect(url).toBe("http://internal.example/internal/stats?days=90");
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { fetchGatewayStats } = await freshServerModule();
		const stats = await fetchGatewayStats(90);

		expect(stats).toEqual(upstreamBody);
	});

	test("fetchGatewayStats degrades gracefully when the upstream call fails", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: "Unauthorized" }), {
						status: 401,
					}),
			),
		);

		const { fetchGatewayStats } = await freshServerModule();
		const stats = await fetchGatewayStats();

		expect(stats).toEqual({
			days: [],
			totals: { requests: 0, errors: 0, cost: 0 },
			note: "Unauthorized",
		});
	});

	test("fetchGatewayStats degrades gracefully when the upstream is unreachable", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		const { fetchGatewayStats } = await freshServerModule();
		const stats = await fetchGatewayStats();

		expect(stats).toEqual({
			days: [],
			totals: { requests: 0, errors: 0, cost: 0 },
			note: "Failed to fetch stats",
		});
	});

	test("GET /api/stats/consumers requires authentication", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/api/stats/consumers`);
		expect(res.status).toBe(401);
	});

	test("fetchConsumerStats returns a note when LLM_INTERNAL_TOKEN is unset", async () => {
		delete process.env.LLM_INTERNAL_TOKEN;
		const { fetchConsumerStats } = await freshServerModule();

		const stats = await fetchConsumerStats();

		expect(stats).toEqual({
			consumers: [],
			note: "LLM_INTERNAL_TOKEN not configured",
		});
	});

	test("fetchConsumerStats forwards the upstream payload on success", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = {
			consumers: [
				{
					apiKeyId: "api-key-a",
					description: "App A backend",
					projectId: "project-a",
					projectName: "App A",
					requests: 42,
					errors: 1,
					cost: 3.14,
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(url).toBe(
					"http://internal.example/internal/stats/by-consumer?days=30",
				);
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-internal-token",
				);
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { fetchConsumerStats } = await freshServerModule();
		const stats = await fetchConsumerStats();

		expect(stats).toEqual(upstreamBody);
	});

	test("fetchConsumerStats degrades gracefully when the upstream call fails", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: "Unauthorized" }), {
						status: 401,
					}),
			),
		);

		const { fetchConsumerStats } = await freshServerModule();
		const stats = await fetchConsumerStats();

		expect(stats).toEqual({
			consumers: [],
			note: "Unauthorized",
		});
	});

	test("GET /api/stats/users requires authentication", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/api/stats/users`);
		expect(res.status).toBe(401);
	});

	test("fetchUserStats returns a note when LLM_INTERNAL_TOKEN is unset", async () => {
		delete process.env.LLM_INTERNAL_TOKEN;
		const { fetchUserStats } = await freshServerModule();

		const stats = await fetchUserStats();

		expect(stats).toEqual({
			users: [],
			note: "LLM_INTERNAL_TOKEN not configured",
		});
	});

	test("fetchUserStats forwards the upstream payload on success", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = {
			users: [
				{
					userId: "user-a",
					name: "Ada Lovelace",
					email: "ada@example.com",
					apiKeyCount: 2,
					requests: 42,
					errors: 1,
					cost: 3.14,
				},
			],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(url).toBe(
					"http://internal.example/internal/stats/by-user?days=30",
				);
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-internal-token",
				);
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { fetchUserStats } = await freshServerModule();
		const stats = await fetchUserStats();

		expect(stats).toEqual(upstreamBody);
	});

	test("fetchUserStats degrades gracefully when the upstream call fails", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: "Unauthorized" }), {
						status: 401,
					}),
			),
		);

		const { fetchUserStats } = await freshServerModule();
		const stats = await fetchUserStats();

		expect(stats).toEqual({
			users: [],
			note: "Unauthorized",
		});
	});

	test("GET /api/tier-routing requires authentication", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/api/tier-routing`);
		expect(res.status).toBe(401);
	});

	test("POST /api/tier-routing/run requires authentication", async () => {
		const { app } = await freshServerModule();
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;

		const res = await fetch(`http://127.0.0.1:${port}/api/tier-routing/run`, {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	test("fetchTierRoutingStatus returns a note when LLM_INTERNAL_TOKEN is unset", async () => {
		delete process.env.LLM_INTERNAL_TOKEN;
		const { fetchTierRoutingStatus } = await freshServerModule();

		const status = await fetchTierRoutingStatus();

		expect(status).toEqual({
			tiers: [],
			checkedAt: null,
			note: "LLM_INTERNAL_TOKEN not configured",
		});
	});

	test("fetchTierRoutingStatus forwards the upstream payload on success", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = {
			tiers: [
				{
					tierId: "tcs-cheap",
					tierName: "Cheap",
					status: "ok",
					selectedProvider: "openai",
					selectedModel: "gpt-4o-mini",
					primaryProvider: "openai",
					primaryModel: "gpt-4o-mini",
					fallbackProviders: [],
					lastCheckedAt: "2026-07-02T00:00:00.000Z",
					lastSuccessAt: "2026-07-02T00:00:00.000Z",
					lastError: null,
					latencyMs: 120,
				},
			],
			checkedAt: "2026-07-02T00:00:00.000Z",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(url).toBe(
					"http://internal.example/internal/tcs-tier-routing-status",
				);
				expect(init?.method ?? "GET").toBe("GET");
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-internal-token",
				);
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { fetchTierRoutingStatus } = await freshServerModule();
		const status = await fetchTierRoutingStatus();

		expect(status).toEqual(upstreamBody);
	});

	test("runTierRoutingCheck posts to the run endpoint and forwards the result", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		const upstreamBody = { tiers: [], checkedAt: null, ran: true };
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				expect(url).toBe(
					"http://internal.example/internal/tcs-tier-routing-status/run",
				);
				expect(init?.method).toBe("POST");
				expect((init?.headers as Record<string, string>).Authorization).toBe(
					"Bearer test-internal-token",
				);
				return new Response(JSON.stringify(upstreamBody), { status: 200 });
			}),
		);

		const { runTierRoutingCheck } = await freshServerModule();
		const status = await runTierRoutingCheck();

		expect(status).toEqual(upstreamBody);
	});

	test("fetchTierRoutingStatus degrades gracefully when the upstream call fails", async () => {
		process.env.LLM_INTERNAL_TOKEN = "test-internal-token";
		process.env.LLM_INTERNAL_URL = "http://internal.example";
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message: "Unauthorized" }), {
						status: 401,
					}),
			),
		);

		const { fetchTierRoutingStatus } = await freshServerModule();
		const status = await fetchTierRoutingStatus();

		expect(status).toEqual({
			tiers: [],
			checkedAt: null,
			note: "Unauthorized",
		});
	});
});
