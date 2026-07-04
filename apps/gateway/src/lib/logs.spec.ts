import { describe, expect, it, vi } from "vitest";

import { UnifiedFinishReason } from "@llmgateway/db";

import {
	calculateDataStorageCost,
	getUnifiedFinishReason,
	insertLog,
	isContentFilterFinishReason,
	isExpectedUnknownFinishReason,
} from "./logs.js";

describe("getUnifiedFinishReason", () => {
	it("maps OpenAI finish reasons correctly", () => {
		expect(getUnifiedFinishReason("stop", "openai")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("length", "openai")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("content_filter", "openai")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});

	it("maps Anthropic finish reasons correctly", () => {
		expect(getUnifiedFinishReason("stop_sequence", "anthropic")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("max_tokens", "anthropic")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("end_turn", "anthropic")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
	});

	it("maps Google AI Studio finish reasons correctly (original Google format)", () => {
		expect(getUnifiedFinishReason("STOP", "google-ai-studio")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("MAX_TOKENS", "google-ai-studio")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("SAFETY", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(
			getUnifiedFinishReason("PROHIBITED_CONTENT", "google-ai-studio"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("RECITATION", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("BLOCKLIST", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("SPII", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("LANGUAGE", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_SAFETY", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(
			getUnifiedFinishReason("IMAGE_PROHIBITED_CONTENT", "google-ai-studio"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("IMAGE_RECITATION", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_OTHER", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("NO_IMAGE", "google-ai-studio")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("OTHER", "google-ai-studio")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps Glacier finish reasons like Google AI Studio", () => {
		expect(getUnifiedFinishReason("STOP", "glacier")).toBe(
			UnifiedFinishReason.COMPLETED,
		);
		expect(getUnifiedFinishReason("MAX_TOKENS", "glacier")).toBe(
			UnifiedFinishReason.LENGTH_LIMIT,
		);
		expect(getUnifiedFinishReason("SAFETY", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("OTHER", "glacier")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps Glacier image content filter finish reasons correctly", () => {
		expect(getUnifiedFinishReason("IMAGE_PROHIBITED_CONTENT", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("IMAGE_SAFETY", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
		expect(getUnifiedFinishReason("NO_IMAGE", "glacier")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});

	it("handles special cases", () => {
		expect(getUnifiedFinishReason("canceled", "any-provider")).toBe(
			UnifiedFinishReason.CANCELED,
		);
		expect(getUnifiedFinishReason("gateway_error", "any-provider")).toBe(
			UnifiedFinishReason.GATEWAY_ERROR,
		);
		expect(getUnifiedFinishReason("upstream_error", "any-provider")).toBe(
			UnifiedFinishReason.UPSTREAM_ERROR,
		);
		expect(getUnifiedFinishReason(null, "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
		expect(getUnifiedFinishReason(undefined, "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
		expect(getUnifiedFinishReason("unknown_reason", "any-provider")).toBe(
			UnifiedFinishReason.UNKNOWN,
		);
	});

	it("maps llmgateway_content_filter to CONTENT_FILTER", () => {
		expect(
			getUnifiedFinishReason("llmgateway_content_filter", "any-provider"),
		).toBe(UnifiedFinishReason.CONTENT_FILTER);
		expect(getUnifiedFinishReason("llmgateway_content_filter", "openai")).toBe(
			UnifiedFinishReason.CONTENT_FILTER,
		);
	});
});

describe("isExpectedUnknownFinishReason", () => {
	it("returns true for Google OTHER finish reason", () => {
		expect(isExpectedUnknownFinishReason("OTHER", "google-ai-studio")).toBe(
			true,
		);
		expect(isExpectedUnknownFinishReason("OTHER", "glacier")).toBe(true);
		expect(isExpectedUnknownFinishReason("OTHER", "google-vertex")).toBe(true);
	});

	it("returns false for OTHER from other providers", () => {
		expect(isExpectedUnknownFinishReason("OTHER", "openai")).toBe(false);
		expect(isExpectedUnknownFinishReason("OTHER", "anthropic")).toBe(false);
	});

	it("returns false for other finish reasons from Google", () => {
		expect(isExpectedUnknownFinishReason("STOP", "google-ai-studio")).toBe(
			false,
		);
		expect(isExpectedUnknownFinishReason("unknown", "google-ai-studio")).toBe(
			false,
		);
	});

	it("returns false for null or undefined finish reasons", () => {
		expect(isExpectedUnknownFinishReason(null, "google-ai-studio")).toBe(false);
		expect(isExpectedUnknownFinishReason(undefined, "google-ai-studio")).toBe(
			false,
		);
	});
});

describe("isContentFilterFinishReason", () => {
	it("returns true for Google-compatible image filter finish reasons", () => {
		expect(
			isContentFilterFinishReason("IMAGE_PROHIBITED_CONTENT", "glacier"),
		).toBe(true);
		expect(
			isContentFilterFinishReason(
				"IMAGE_PROHIBITED_CONTENT",
				"google-ai-studio",
			),
		).toBe(true);
	});

	it("returns false for Google OTHER finish reason", () => {
		expect(isContentFilterFinishReason("OTHER", "glacier")).toBe(false);
	});

	it("returns true for OpenAI content filters", () => {
		expect(isContentFilterFinishReason("content_filter", "openai")).toBe(true);
	});
});

describe("calculateDataStorageCost", () => {
	it("calculates cost based on total tokens", () => {
		// 1M tokens = $0.01 (formula: totalTokens / 1_000_000 * 0.01)
		const cost = calculateDataStorageCost(500000, 0, 500000, 0);
		expect(cost).toBe("0.01"); // 1M tokens * $0.01 per 1M = $0.01
	});

	it("does not double-count cached tokens when promptTokens already includes them", () => {
		// promptTokens is the canonical input count in gateway logs.
		// cachedTokens is tracked separately for pricing and diagnostics, but should
		// not increase storage accounting a second time.
		const cost = calculateDataStorageCost(500000, 250000, 250000, 250000);
		expect(cost).toBe("0.01"); // 1M tokens * $0.01 per 1M = $0.01
	});

	it("returns zero when retention level is none", () => {
		const cost = calculateDataStorageCost(1000000, 0, 1000000, 0, "none");
		expect(cost).toBe("0");
	});

	it("calculates cost when retention level is retain", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, "retain");
		expect(cost).toBe("0.01");
	});

	it("calculates cost when retention level is null", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, null);
		expect(cost).toBe("0.01");
	});

	it("calculates cost when retention level is undefined", () => {
		const cost = calculateDataStorageCost(500000, 0, 500000, 0, undefined);
		expect(cost).toBe("0.01");
	});

	it("handles null and undefined token values", () => {
		const cost = calculateDataStorageCost(null, undefined, null, undefined);
		expect(cost).toBe("0");
	});

	it("handles string token values", () => {
		const cost = calculateDataStorageCost("500000", "0", "500000", "0");
		expect(cost).toBe("0.01");
	});
});

vi.mock("@llmgateway/cache", () => ({
	publishToQueue: vi.fn(),
	LOG_QUEUE: "log_queue_test",
	redisClient: {
		on: vi.fn(),
		get: vi.fn(),
		set: vi.fn(),
	},
}));

vi.mock("@llmgateway/instrumentation", () => ({
	recordChatCompletionMetrics: vi.fn(),
}));

vi.mock("@llmgateway/db", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		db: vi.fn(),
	};
});

describe("insertLog", () => {
	const baseLogData = {
		requestId: "test-req-123",
		organizationId: "org-1",
		projectId: "proj-1",
		apiKeyId: "key-1",
		usedProvider: "openai",
		usedModel: "gpt-4o",
		finishReason: "stop",
		streamed: false,
		canceled: false,
		hasError: false,
		duration: 100,
		timeToFirstToken: null,
		timeToFirstReasoningToken: null,
		responseSize: 50,
		content: "hello",
		reasoningContent: null,
		promptTokens: "10",
		completionTokens: "5",
		totalTokens: "15",
		reasoningTokens: null,
		cachedTokens: null,
		errorDetails: null,
		inputCost: 0,
		outputCost: 0,
		cachedInputCost: 0,
		requestCost: 0,
		webSearchCost: 0,
		imageInputTokens: null,
		imageOutputTokens: null,
		imageInputCost: null,
		imageOutputCost: null,
		cost: 0,
		estimatedCost: false,
		discount: null,
		pricingTier: null,
		dataStorageCost: "0",
		cached: false,
		tools: null,
		toolResults: null,
		toolChoice: undefined,
	};

	it("does not throw when Redis queue publish fails", async () => {
		const { publishToQueue } = await import("@llmgateway/cache");
		vi.mocked(publishToQueue).mockRejectedValueOnce(
			new Error("ECONNREFUSED: Redis connection refused"),
		);

		const result = await insertLog(baseLogData as any);
		expect(result).toBe(0);
	});

	it("returns 1 when queue publish succeeds", async () => {
		const { publishToQueue } = await import("@llmgateway/cache");
		vi.mocked(publishToQueue).mockResolvedValueOnce(undefined);

		const result = await insertLog(baseLogData as any);
		expect(result).toBe(1);
	});
});
