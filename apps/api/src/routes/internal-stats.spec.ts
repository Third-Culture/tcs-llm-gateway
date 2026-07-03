import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, projectHourlyStats } from "@llmgateway/db";

describe("internal stats endpoint", () => {
	const originalToken = process.env.INTERNAL_STATS_TOKEN;

	beforeEach(async () => {
		await deleteAll();
		process.env.INTERNAL_STATS_TOKEN = "test-internal-stats-token";
	});

	afterEach(() => {
		if (originalToken === undefined) {
			delete process.env.INTERNAL_STATS_TOKEN;
		} else {
			process.env.INTERNAL_STATS_TOKEN = originalToken;
		}
	});

	test("rejects requests without an Authorization header", async () => {
		const res = await app.request("/internal/stats");
		expect(res.status).toBe(401);
	});

	test("rejects requests with an incorrect token", async () => {
		const res = await app.request("/internal/stats", {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 501 when INTERNAL_STATS_TOKEN is not configured", async () => {
		delete process.env.INTERNAL_STATS_TOKEN;
		const res = await app.request("/internal/stats", {
			headers: { Authorization: "Bearer anything" },
		});
		expect(res.status).toBe(501);
	});

	test("aggregates request/error/cost totals across projects for the default 30-day window", async () => {
		const today = new Date();
		today.setUTCHours(12, 0, 0, 0);
		const yesterday = new Date(today);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		const fortyDaysAgo = new Date(today);
		fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40);

		await db.insert(projectHourlyStats).values([
			{
				id: "phs-1",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 10,
				errorCount: 1,
				cost: 1.5,
			},
			{
				id: "phs-2",
				projectId: "project-b",
				hourTimestamp: today,
				requestCount: 5,
				errorCount: 0,
				cost: 0.5,
			},
			{
				id: "phs-3",
				projectId: "project-a",
				hourTimestamp: yesterday,
				requestCount: 3,
				errorCount: 2,
				cost: 0.25,
			},
			// Outside the default 30-day window; must not be counted.
			{
				id: "phs-4",
				projectId: "project-a",
				hourTimestamp: fortyDaysAgo,
				requestCount: 1000,
				errorCount: 1000,
				cost: 1000,
			},
		]);

		const res = await app.request("/internal/stats", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.totals).toEqual({ requests: 18, errors: 3, cost: 2.25 });
		expect(body.days).toHaveLength(2);
		expect(body.days.map((d: { requests: number }) => d.requests)).toEqual([
			3, 15,
		]);
	});

	test("honors a custom `days` query param to look further back", async () => {
		const today = new Date();
		today.setUTCHours(12, 0, 0, 0);
		const fortyDaysAgo = new Date(today);
		fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40);

		await db.insert(projectHourlyStats).values([
			{
				id: "phs-1",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 10,
				errorCount: 1,
				cost: 1.5,
			},
			{
				id: "phs-2",
				projectId: "project-a",
				hourTimestamp: fortyDaysAgo,
				requestCount: 7,
				errorCount: 0,
				cost: 0.7,
			},
		]);

		const res = await app.request("/internal/stats?days=60", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.totals).toEqual({ requests: 17, errors: 1, cost: 2.2 });
		expect(body.days).toHaveLength(2);
	});

	test("rejects a `days` value beyond the max window", async () => {
		const res = await app.request("/internal/stats?days=91", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(400);
	});
});
