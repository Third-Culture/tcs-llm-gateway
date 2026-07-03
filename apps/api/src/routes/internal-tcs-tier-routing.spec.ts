import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, tcsTierRoutingStatus } from "@llmgateway/db";

describe("internal TCS tier routing status endpoint", () => {
	const originalToken = process.env.INTERNAL_STATS_TOKEN;
	const originalApiKey = process.env.TCS_TIER_CHECK_API_KEY;

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
		if (originalApiKey === undefined) {
			delete process.env.TCS_TIER_CHECK_API_KEY;
		} else {
			process.env.TCS_TIER_CHECK_API_KEY = originalApiKey;
		}
	});

	test("rejects requests without an Authorization header", async () => {
		const res = await app.request("/internal/tcs-tier-routing-status");
		expect(res.status).toBe(401);
	});

	test("rejects requests with an incorrect token", async () => {
		const res = await app.request("/internal/tcs-tier-routing-status", {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 501 when INTERNAL_STATS_TOKEN is not configured", async () => {
		delete process.env.INTERNAL_STATS_TOKEN;
		const res = await app.request("/internal/tcs-tier-routing-status", {
			headers: { Authorization: "Bearer anything" },
		});
		expect(res.status).toBe(501);
	});

	test("returns tiers with unknown status when nothing has been checked yet", async () => {
		const res = await app.request("/internal/tcs-tier-routing-status", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.checkedAt).toBeNull();
		expect(body.tiers.length).toBeGreaterThan(0);
		expect(
			body.tiers.every((tier: { status: string }) => tier.status === "unknown"),
		).toBe(true);
	});

	test("reflects a persisted check result for a tier", async () => {
		const checkedAt = new Date();
		await db.insert(tcsTierRoutingStatus).values({
			tierId: "tcs-cheap",
			tierName: "TCS Cheap",
			status: "ok",
			selectedProvider: "openai",
			selectedModel: "gpt-4o-mini",
			primaryProvider: "openai",
			primaryModel: "gpt-4o-mini",
			fallbackProviders: [],
			lastCheckedAt: checkedAt,
			lastSuccessAt: checkedAt,
			lastError: null,
			latencyMs: 123,
		});

		const res = await app.request("/internal/tcs-tier-routing-status", {
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		const cheapTier = body.tiers.find(
			(tier: { tierId: string }) => tier.tierId === "tcs-cheap",
		);
		expect(cheapTier.status).toBe("ok");
		expect(cheapTier.selectedProvider).toBe("openai");
		expect(cheapTier.latencyMs).toBe(123);
	});

	test("run endpoint reports it did not run when TCS_TIER_CHECK_API_KEY is unset", async () => {
		delete process.env.TCS_TIER_CHECK_API_KEY;
		const res = await app.request("/internal/tcs-tier-routing-status/run", {
			method: "POST",
			headers: { Authorization: "Bearer test-internal-stats-token" },
		});
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body.ran).toBe(false);
		expect(body.reason).toMatch(/TCS_TIER_CHECK_API_KEY/);
	});

	test("run endpoint requires authentication", async () => {
		const res = await app.request("/internal/tcs-tier-routing-status/run", {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});
});
