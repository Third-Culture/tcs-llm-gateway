import { describe, expect, it } from "vitest";

import { listTcsRoutingTiers } from "./tcs.js";

describe("listTcsRoutingTiers", () => {
	it("returns all configured TCS tiers with primary provider metadata", () => {
		const tiers = listTcsRoutingTiers();

		expect(tiers.length).toBe(5);
		expect(tiers.map((tier) => tier.id)).toEqual([
			"tcs-cheap",
			"tcs-balanced",
			"tcs-reasoning",
			"tcs-premium",
			"tcs-vision",
		]);

		for (const tier of tiers) {
			expect(tier.primaryProvider).toBe(tier.providers[0]?.providerId);
			expect(tier.primaryModel).toBe(tier.providers[0]?.modelName);
			expect(tier.providers.length).toBeGreaterThan(0);
		}
	});
});
