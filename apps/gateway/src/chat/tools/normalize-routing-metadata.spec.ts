import { describe, expect, it } from "vitest";

import { normalizeRoutingMetadataForLogging } from "./normalize-routing-metadata.js";

describe("normalizeRoutingMetadataForLogging", () => {
	it("hides collapsed regions for price-only provider scores", () => {
		const metadata = normalizeRoutingMetadataForLogging({
			availableProviders: ["novita", "alibaba", "bytedance"],
			selectedProvider: "novita",
			selectionReason: "price-only-no-metrics",
			providerScores: [
				{ providerId: "novita", score: 0, price: 0.0000003345 },
				{
					providerId: "alibaba",
					region: "singapore",
					score: 0,
					price: 0.000000912,
				},
				{ providerId: "bytedance", score: 0, price: 0.00000035 },
			],
		});

		const alibabaScore = metadata.providerScores.find(
			(score) => score.providerId === "alibaba",
		);

		expect(alibabaScore?.region).toBeUndefined();
	});

	it("keeps explicit regions when the score table compares regions directly", () => {
		const metadata = normalizeRoutingMetadataForLogging({
			availableProviders: ["alibaba"],
			selectedProvider: "alibaba",
			selectionReason: "price-only-no-metrics",
			providerScores: [
				{
					providerId: "alibaba",
					region: "singapore",
					score: 0,
					price: 0.000000912,
				},
				{
					providerId: "alibaba",
					region: "cn-beijing",
					score: 0,
					price: 0.0000002872,
				},
			],
		});

		expect(metadata.providerScores).toEqual([
			expect.objectContaining({
				providerId: "alibaba",
				region: "singapore",
			}),
			expect.objectContaining({
				providerId: "alibaba",
				region: "cn-beijing",
			}),
		]);
	});

	it("does not change non price-only routing metadata", () => {
		const metadata = normalizeRoutingMetadataForLogging({
			availableProviders: ["alibaba"],
			selectedProvider: "alibaba",
			selectionReason: "weighted-score",
			providerScores: [
				{
					providerId: "alibaba",
					region: "cn-beijing",
					score: 0.1,
					price: 0.0000002872,
				},
			],
		});

		expect(metadata.providerScores[0]?.region).toBe("cn-beijing");
	});
});
