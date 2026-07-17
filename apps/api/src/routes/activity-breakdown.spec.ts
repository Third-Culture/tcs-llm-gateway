import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import {
	createTestUser,
	deleteAll,
	aggregateLogsForTesting,
} from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("activity breakdown endpoints", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.user).values({
			id: "test-user-id-2",
			name: "Second User",
			email: "second@example.com",
			emailVerified: true,
		});

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		await db.insert(tables.apiKey).values([
			{
				id: "test-api-key-id",
				token: "test-token",
				projectId: "test-project-id",
				description: "Production Backend",
				createdBy: "test-user-id",
			},
			{
				id: "test-api-key-id-2",
				token: "test-token-2",
				projectId: "test-project-id",
				description: "Marketing Bot",
				createdBy: "test-user-id-2",
			},
		]);

		const today = new Date();

		await db.insert(tables.log).values([
			{
				id: "log-1",
				requestId: "log-1",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				cost: 0.6,
				hasError: false,
				cached: false,
				customHeaders: { "user-id": "alice" },
				messages: JSON.stringify([{ role: "user", content: "Hello" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-2",
				requestId: "log-2",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id",
				duration: 100,
				requestedModel: "gpt-4",
				requestedProvider: "openai",
				usedModel: "gpt-4",
				usedProvider: "openai",
				responseSize: 1000,
				promptTokens: "10",
				completionTokens: "20",
				totalTokens: "30",
				cost: 0.4,
				hasError: true,
				cached: false,
				customHeaders: { "user-id": "bob" },
				messages: JSON.stringify([{ role: "user", content: "Hi" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
			{
				id: "log-3",
				requestId: "log-3",
				createdAt: today,
				updatedAt: today,
				organizationId: "test-org-id",
				projectId: "test-project-id",
				apiKeyId: "test-api-key-id-2",
				duration: 100,
				requestedModel: "gpt-3.5-turbo",
				requestedProvider: "openai",
				usedModel: "gpt-3.5-turbo",
				usedProvider: "openai",
				responseSize: 800,
				promptTokens: "5",
				completionTokens: "15",
				totalTokens: "20",
				cost: 0.2,
				hasError: false,
				cached: true,
				messages: JSON.stringify([{ role: "user", content: "Yo" }]),
				mode: "api-keys",
				usedMode: "api-keys",
			},
		]);

		await aggregateLogsForTesting();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("GET /activity/breakdown should require authentication", async () => {
		const res = await app.request(
			"/activity/breakdown?dimension=apiKey&days=7",
		);
		expect(res.status).toBe(401);
	});

	test("GET /activity/breakdown?dimension=apiKey groups by API key, sorted by cost desc", async () => {
		const res = await app.request(
			"/activity/breakdown?dimension=apiKey&days=7",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.breakdown).toHaveLength(2);
		expect(data.breakdown[0].key).toBe("test-api-key-id");
		expect(data.breakdown[0].label).toBe("Production Backend");
		expect(data.breakdown[0].secondaryLabel).toContain("Test User");
		expect(data.breakdown[0].cost).toBeCloseTo(1.0, 2);
		expect(data.breakdown[0].requestCount).toBe(2);
		expect(data.breakdown[0].errorCount).toBe(1);

		expect(data.breakdown[1].key).toBe("test-api-key-id-2");
		expect(data.breakdown[1].label).toBe("Marketing Bot");
		expect(data.breakdown[1].cost).toBeCloseTo(0.2, 2);
		expect(data.breakdown[1].requestCount).toBe(1);

		expect(data.totalCost).toBeCloseTo(1.2, 2);
		expect(data.totalRequests).toBe(3);
	});

	test("GET /activity/breakdown?dimension=user groups by the key creator", async () => {
		const res = await app.request("/activity/breakdown?dimension=user&days=7", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.breakdown).toHaveLength(2);

		const testUser = data.breakdown.find(
			(row: any) => row.key === "test-user-id",
		);
		expect(testUser).toBeDefined();
		expect(testUser.label).toBe("Test User");
		expect(testUser.secondaryLabel).toBe("1 API key");
		expect(testUser.cost).toBeCloseTo(1.0, 2);
		expect(testUser.requestCount).toBe(2);

		const secondUser = data.breakdown.find(
			(row: any) => row.key === "test-user-id-2",
		);
		expect(secondUser).toBeDefined();
		expect(secondUser.label).toBe("Second User");
		expect(secondUser.cost).toBeCloseTo(0.2, 2);
		expect(secondUser.requestCount).toBe(1);
	});

	test("GET /activity/breakdown/metadata groups by a custom header value", async () => {
		const res = await app.request(
			"/activity/breakdown/metadata?metadataKey=user-id&days=7",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.breakdown).toHaveLength(2);
		const alice = data.breakdown.find((row: any) => row.key === "alice");
		const bob = data.breakdown.find((row: any) => row.key === "bob");

		expect(alice).toBeDefined();
		expect(alice.cost).toBeCloseTo(0.6, 2);
		expect(alice.requestCount).toBe(1);

		expect(bob).toBeDefined();
		expect(bob.cost).toBeCloseTo(0.4, 2);
		expect(bob.requestCount).toBe(1);
	});

	test("GET /activity/breakdown/metadata returns empty breakdown for an unused key", async () => {
		const res = await app.request(
			"/activity/breakdown/metadata?metadataKey=tenant-id&days=7",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.breakdown).toHaveLength(0);
		expect(data.totalCost).toBe(0);
	});

	test("GET /activity/breakdown/metadata rejects invalid metadata keys", async () => {
		const res = await app.request(
			"/activity/breakdown/metadata?metadataKey=not_valid!&days=7",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(400);
	});

	test("GET /activity/breakdown/metadata-keys discovers keys sent in custom headers", async () => {
		const res = await app.request("/activity/breakdown/metadata-keys", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.keys).toContain("user-id");
	});

	test("GET /activity/breakdown returns 400 for an unparseable from/to date", async () => {
		const res = await app.request(
			"/activity/breakdown?dimension=apiKey&from=not-a-date&to=2026-01-01",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(400);
	});

	test("GET /activity/breakdown/metadata returns 400 for an unparseable date", async () => {
		const res = await app.request(
			"/activity/breakdown/metadata?metadataKey=user-id&from=2026-01-01&to=garbage",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(400);
	});

	test("GET /activity/breakdown still honors a valid explicit from/to range", async () => {
		const res = await app.request(
			"/activity/breakdown?dimension=apiKey&from=2020-01-01&to=2100-01-01",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.breakdown).toHaveLength(2);
	});
});
