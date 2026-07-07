import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	apiKeyHourlyStats,
	db,
	projectHourlyStats,
	tables,
	user,
} from "@llmgateway/db";

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
		expect(
			body.days.map((d: { requests: number; cost: number }) => ({
				requests: d.requests,
				cost: d.cost,
			})),
		).toEqual([
			{ requests: 3, cost: 0.25 },
			{ requests: 15, cost: 2 },
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

describe("internal stats by-consumer endpoint", () => {
	const originalToken = process.env.INTERNAL_STATS_TOKEN;

	beforeEach(async () => {
		await deleteAll();
		process.env.INTERNAL_STATS_TOKEN = "test-internal-stats-token";

		await createTestUser();
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: "project-a",
				name: "Consumer App A",
				organizationId: "test-org-id",
			},
			{
				id: "project-b",
				name: "Consumer App B",
				organizationId: "test-org-id",
			},
		]);
		await db.insert(tables.apiKey).values([
			{
				id: "api-key-a",
				token: "token-a",
				projectId: "project-a",
				description: "App A backend",
				createdBy: "test-user-id",
			},
			{
				id: "api-key-b",
				token: "token-b",
				projectId: "project-b",
				description: "App B backend",
				createdBy: "test-user-id",
			},
		]);
	});

	afterEach(() => {
		if (originalToken === undefined) {
			delete process.env.INTERNAL_STATS_TOKEN;
		} else {
			process.env.INTERNAL_STATS_TOKEN = originalToken;
		}
	});

	test("rejects requests without an Authorization header", async () => {
		const res = await app.request("/internal/stats/by-consumer");
		expect(res.status).toBe(401);
	});

	test("returns usage per API key, labeled with description and project name", async () => {
		const today = new Date();
		today.setUTCHours(12, 0, 0, 0);
		const fortyDaysAgo = new Date(today);
		fortyDaysAgo.setUTCDate(fortyDaysAgo.getUTCDate() - 40);

		await db.insert(apiKeyHourlyStats).values([
			{
				id: "aks-1",
				apiKeyId: "api-key-a",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 10,
				errorCount: 1,
				cost: 1.5,
			},
			{
				id: "aks-2",
				apiKeyId: "api-key-b",
				projectId: "project-b",
				hourTimestamp: today,
				requestCount: 30,
				errorCount: 0,
				cost: 0.5,
			},
			// Outside the default 30-day window; must not be counted.
			{
				id: "aks-3",
				apiKeyId: "api-key-a",
				projectId: "project-a",
				hourTimestamp: fortyDaysAgo,
				requestCount: 1000,
				errorCount: 1000,
				cost: 1000,
			},
		]);

		const res = await app.request("/internal/stats/by-consumer", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.consumers).toEqual([
			{
				apiKeyId: "api-key-b",
				description: "App B backend",
				usageType: "service",
				projectId: "project-b",
				projectName: "Consumer App B",
				requests: 30,
				errors: 0,
				cost: 0.5,
			},
			{
				apiKeyId: "api-key-a",
				description: "App A backend",
				usageType: "service",
				projectId: "project-a",
				projectName: "Consumer App A",
				requests: 10,
				errors: 1,
				cost: 1.5,
			},
		]);
	});
});

describe("internal stats by-user endpoint", () => {
	const originalToken = process.env.INTERNAL_STATS_TOKEN;

	beforeEach(async () => {
		await deleteAll();
		process.env.INTERNAL_STATS_TOKEN = "test-internal-stats-token";

		await createTestUser();
		await db.insert(user).values({
			id: "test-user-id-2",
			name: "Second Person",
			email: "second@example.com",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});
		await db.insert(tables.project).values([
			{
				id: "project-a",
				name: "Consumer App A",
				organizationId: "test-org-id",
			},
			{
				id: "project-b",
				name: "Consumer App B",
				organizationId: "test-org-id",
			},
		]);
		await db.insert(tables.apiKey).values([
			{
				id: "api-key-a",
				token: "token-a",
				projectId: "project-a",
				description: "App A backend",
				usageType: "personal",
				createdBy: "test-user-id",
			},
			{
				id: "api-key-b",
				token: "token-b",
				projectId: "project-a",
				description: "App B backend",
				usageType: "personal",
				createdBy: "test-user-id",
			},
			{
				id: "api-key-c",
				token: "token-c",
				projectId: "project-b",
				description: "App C backend",
				usageType: "personal",
				createdBy: "test-user-id-2",
			},
			{
				id: "api-key-service",
				token: "token-service",
				projectId: "project-b",
				description: "Automated integration",
				usageType: "service",
				createdBy: "test-user-id",
			},
		]);
	});

	afterEach(() => {
		if (originalToken === undefined) {
			delete process.env.INTERNAL_STATS_TOKEN;
		} else {
			process.env.INTERNAL_STATS_TOKEN = originalToken;
		}
	});

	test("rejects requests without an Authorization header", async () => {
		const res = await app.request("/internal/stats/by-user");
		expect(res.status).toBe(401);
	});

	test("rolls multiple API keys created by the same person into one row", async () => {
		const today = new Date();
		today.setUTCHours(12, 0, 0, 0);

		await db.insert(apiKeyHourlyStats).values([
			{
				id: "aks-1",
				apiKeyId: "api-key-a",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 10,
				errorCount: 1,
				cost: 1.5,
			},
			{
				id: "aks-2",
				apiKeyId: "api-key-b",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 5,
				errorCount: 0,
				cost: 0.5,
			},
			{
				id: "aks-3",
				apiKeyId: "api-key-c",
				projectId: "project-b",
				hourTimestamp: today,
				requestCount: 30,
				errorCount: 0,
				cost: 3,
			},
		]);

		const res = await app.request("/internal/stats/by-user", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.users).toEqual([
			{
				userId: "test-user-id-2",
				name: "Second Person",
				email: "second@example.com",
				apiKeyCount: 1,
				requests: 30,
				errors: 0,
				cost: 3,
			},
			{
				userId: "test-user-id",
				name: "Test User",
				email: "admin@example.com",
				apiKeyCount: 2,
				requests: 15,
				errors: 1,
				cost: 2,
			},
		]);
	});

	test("excludes keys marked usageType 'service' from attribution", async () => {
		const today = new Date();
		today.setUTCHours(12, 0, 0, 0);

		await db.insert(apiKeyHourlyStats).values([
			{
				id: "aks-1",
				apiKeyId: "api-key-a",
				projectId: "project-a",
				hourTimestamp: today,
				requestCount: 10,
				errorCount: 1,
				cost: 1.5,
			},
			// This key is createdBy the same user, but it's a service key, so its
			// cost must not be attributed to that person.
			{
				id: "aks-service",
				apiKeyId: "api-key-service",
				projectId: "project-b",
				hourTimestamp: today,
				requestCount: 1000,
				errorCount: 500,
				cost: 100,
			},
		]);

		const res = await app.request("/internal/stats/by-user", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.users).toEqual([
			{
				userId: "test-user-id",
				name: "Test User",
				email: "admin@example.com",
				apiKeyCount: 1,
				requests: 10,
				errors: 1,
				cost: 1.5,
			},
		]);
	});
});
