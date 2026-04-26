import { describe, expect, it } from "vitest";

import { completionsRequestSchema } from "./completions.js";

describe("completionsRequestSchema task field", () => {
	const baseRequest = {
		model: "auto",
		messages: [
			{
				role: "user",
				content: "Hello",
			},
		],
	};

	it("accepts a builtin task profile id as a string", () => {
		const result = completionsRequestSchema.safeParse({
			...baseRequest,
			task: "company_refresh_json",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.task).toBe("company_refresh_json");
		}
	});

	it("accepts an inline task profile object", () => {
		const inline = {
			id: "company_refresh_json",
			requires: { jsonOutput: true, vision: true },
			limits: { minContextSize: 64_000, minMaxOutput: 1024 },
			expected: { inputTokens: 1500, outputTokens: 600 },
			pricing: { maxInputPricePerToken: 1e-5, maxEstimatedCost: 0.05 },
			models: { allow: ["gpt-4o-mini"] },
			providers: { deny: ["azure"] },
			qualityFloor: "medium" as const,
		};
		const result = completionsRequestSchema.safeParse({
			...baseRequest,
			task: inline,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.task).toEqual(inline);
		}
	});

	it("rejects an inline task profile without an id", () => {
		const result = completionsRequestSchema.safeParse({
			...baseRequest,
			task: {
				requires: { jsonOutput: true },
			},
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative expected token counts", () => {
		const result = completionsRequestSchema.safeParse({
			...baseRequest,
			task: {
				id: "x",
				expected: { inputTokens: -1 },
			},
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative pricing caps", () => {
		const result = completionsRequestSchema.safeParse({
			...baseRequest,
			task: {
				id: "x",
				pricing: { maxInputPricePerToken: -1 },
			},
		});
		expect(result.success).toBe(false);
	});

	it("treats task as optional", () => {
		const result = completionsRequestSchema.safeParse(baseRequest);
		expect(result.success).toBe(true);
	});
});
