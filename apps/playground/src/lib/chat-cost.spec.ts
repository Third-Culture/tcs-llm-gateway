import { describe, expect, it } from "vitest";

import {
	extractGatewayCostFromProviderMetadata,
	formatUsd,
	getMessageCost,
	getSessionCost,
	type PlaygroundChatMessage,
} from "./chat-cost";

describe("chat-cost", () => {
	it("extracts gateway cost from provider metadata", () => {
		expect(
			extractGatewayCostFromProviderMetadata({
				llmgateway: { usage: { cost: 0.000125 } },
			}),
		).toBe(0.000125);
	});

	it("returns undefined for missing cost", () => {
		expect(extractGatewayCostFromProviderMetadata(undefined)).toBeUndefined();
		expect(
			extractGatewayCostFromProviderMetadata({ llmgateway: { usage: {} } }),
		).toBeUndefined();
	});

	it("sums assistant message costs for the session", () => {
		const messages: PlaygroundChatMessage[] = [
			{
				id: "1",
				role: "user",
				parts: [{ type: "text", text: "Hi" }],
			},
			{
				id: "2",
				role: "assistant",
				parts: [{ type: "text", text: "Hello" }],
				metadata: { cost: 0.0001 },
			},
			{
				id: "3",
				role: "user",
				parts: [{ type: "text", text: "Again" }],
			},
			{
				id: "4",
				role: "assistant",
				parts: [{ type: "text", text: "Sure" }],
				metadata: { cost: 0.00025 },
			},
		];

		expect(getMessageCost(messages[1]!)).toBe(0.0001);
		expect(getSessionCost(messages)).toBeCloseTo(0.00035);
	});

	it("formats small and large USD amounts", () => {
		expect(formatUsd(0.000125)).toBe("$0.000125");
		expect(formatUsd(0.0123)).toBe("$0.0123");
	});
});
