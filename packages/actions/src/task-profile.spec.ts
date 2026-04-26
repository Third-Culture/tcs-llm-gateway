import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	BUILTIN_TASK_PROFILES,
	buildTaskCandidates,
	estimateTaskCost,
	resolveTaskProfile,
	selectModelForTask,
	type TaskProfile,
} from "./task-profile.js";

import type { ProviderModelMapping } from "@llmgateway/models";

function findMapping(
	modelId: string,
	providerId: string,
): ProviderModelMapping {
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		throw new Error(`test fixture missing model ${modelId}`);
	}
	const mapping = (model.providers as ProviderModelMapping[]).find(
		(p) => p.providerId === providerId,
	);
	if (!mapping) {
		throw new Error(
			`test fixture missing provider ${providerId} on model ${modelId}`,
		);
	}
	return mapping;
}

describe("resolveTaskProfile", () => {
	it("returns undefined for undefined input", () => {
		expect(resolveTaskProfile(undefined)).toBeUndefined();
	});

	it("resolves builtin profiles by id", () => {
		const profile = resolveTaskProfile("company_refresh_json");
		expect(profile).toBe(BUILTIN_TASK_PROFILES.company_refresh_json);
	});

	it("throws on unknown builtin id", () => {
		expect(() => resolveTaskProfile("does_not_exist")).toThrow(
			/Unknown task profile id/,
		);
	});

	it("returns the inline profile when given an object", () => {
		const inline: TaskProfile = {
			id: "custom",
			expected: { inputTokens: 100, outputTokens: 50 },
		};
		expect(resolveTaskProfile(inline)).toBe(inline);
	});

	it("rejects inline profiles without an id", () => {
		expect(() =>
			resolveTaskProfile({ id: "" } as unknown as TaskProfile),
		).toThrow(/non-empty "id"/);
	});
});

describe("estimateTaskCost", () => {
	it("uses expected token shape when provided", () => {
		const mapping: ProviderModelMapping = {
			providerId: "openai",
			modelName: "fixture",
			inputPrice: 1e-6,
			outputPrice: 2e-6,
			streaming: true,
		};
		const profile: TaskProfile = {
			id: "t",
			expected: { inputTokens: 1000, outputTokens: 500 },
		};
		expect(estimateTaskCost(mapping, profile)).toBeCloseTo(1e-3 + 1e-3);
	});

	it("falls back to (input + output) / 2 when expected is missing", () => {
		const mapping: ProviderModelMapping = {
			providerId: "openai",
			modelName: "fixture",
			inputPrice: 4,
			outputPrice: 6,
			streaming: true,
		};
		expect(estimateTaskCost(mapping, { id: "t" })).toBe(5);
	});

	it("includes per-request pricing", () => {
		const mapping: ProviderModelMapping = {
			providerId: "openai",
			modelName: "fixture",
			inputPrice: 0,
			outputPrice: 0,
			requestPrice: 0.0005,
			streaming: true,
		};
		const profile: TaskProfile = {
			id: "t",
			expected: { inputTokens: 100, outputTokens: 50 },
		};
		expect(estimateTaskCost(mapping, profile)).toBeCloseTo(0.0005);
	});

	it("applies discount multipliers", () => {
		const mapping: ProviderModelMapping = {
			providerId: "openai",
			modelName: "fixture",
			inputPrice: 1,
			outputPrice: 1,
			discount: 0.5,
			streaming: true,
		};
		const profile: TaskProfile = {
			id: "t",
			expected: { inputTokens: 1, outputTokens: 1 },
		};
		expect(estimateTaskCost(mapping, profile)).toBeCloseTo(1);
	});
});

describe("buildTaskCandidates", () => {
	const baseAvailable = ["openai", "anthropic", "google"];

	it("drops models without required JSON capability", () => {
		const profile: TaskProfile = {
			id: "json",
			requires: { jsonOutput: true },
			expected: { inputTokens: 100, outputTokens: 50 },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: baseAvailable,
		});
		for (const c of candidates) {
			expect(c.provider.jsonOutput).toBe(true);
		}
	});

	it("respects context size requirement", () => {
		const profile: TaskProfile = {
			id: "long",
			limits: { minContextSize: 100_000 },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: baseAvailable,
		});
		for (const c of candidates) {
			expect((c.provider.contextSize ?? 0) >= 100_000).toBe(true);
		}
	});

	it("ranks cheaper models first when capabilities are equal", () => {
		const profile: TaskProfile = {
			id: "rank",
			requires: { jsonOutput: true },
			expected: { inputTokens: 1000, outputTokens: 500 },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: baseAvailable,
		});
		expect(candidates.length).toBeGreaterThan(1);
		for (let i = 1; i < candidates.length; i++) {
			expect(candidates[i].estimatedCost).toBeGreaterThanOrEqual(
				candidates[i - 1].estimatedCost,
			);
		}
	});

	it("input-heavy workloads prefer cheaper input pricing", () => {
		const inputHeavy: TaskProfile = {
			id: "input-heavy",
			requires: { jsonOutput: true },
			expected: { inputTokens: 100_000, outputTokens: 100 },
		};
		const outputHeavy: TaskProfile = {
			id: "output-heavy",
			requires: { jsonOutput: true },
			expected: { inputTokens: 100, outputTokens: 100_000 },
		};
		const inputTop = buildTaskCandidates(inputHeavy, {
			availableProviders: baseAvailable,
		})[0];
		const outputTop = buildTaskCandidates(outputHeavy, {
			availableProviders: baseAvailable,
		})[0];
		expect(inputTop).toBeDefined();
		expect(outputTop).toBeDefined();
		expect(inputTop.provider.inputPrice ?? 0).toBeLessThanOrEqual(
			outputTop.provider.outputPrice ?? Infinity,
		);
	});

	it("respects max input/output price caps", () => {
		const haiku = findMapping("claude-haiku-4-5", "anthropic");
		const profile: TaskProfile = {
			id: "capped",
			requires: { jsonOutput: true },
			pricing: {
				maxInputPricePerToken: (haiku.inputPrice ?? 0) - 1e-12,
				maxOutputPricePerToken: (haiku.outputPrice ?? 0) - 1e-12,
			},
			expected: { inputTokens: 1000, outputTokens: 500 },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: baseAvailable,
		});
		expect(
			candidates.find((c) => c.model.id === "claude-haiku-4-5"),
		).toBeUndefined();
	});

	it("respects free_models_only", () => {
		const profile: TaskProfile = {
			id: "free",
			expected: { inputTokens: 100, outputTokens: 50 },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: [
				"openai",
				"anthropic",
				"google",
				"deepseek",
				"llmgateway",
			],
			freeModelsOnly: true,
		});
		for (const c of candidates) {
			expect((c.model as { free?: boolean }).free).toBe(true);
		}
	});

	it("excludes reasoning models when noReasoning is set", () => {
		const profile: TaskProfile = {
			id: "no-reason",
			requires: { jsonOutput: true },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: baseAvailable,
			noReasoning: true,
		});
		for (const c of candidates) {
			expect(c.provider.reasoning).not.toBe(true);
		}
	});

	it("drops candidates whose providers are unavailable", () => {
		const profile: TaskProfile = {
			id: "openai-only",
			requires: { jsonOutput: true },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: ["openai"],
		});
		for (const c of candidates) {
			expect(c.provider.providerId).toBe("openai");
		}
		expect(candidates.length).toBeGreaterThan(0);
	});

	it("respects iamAllowedProviders intersection", () => {
		const profile: TaskProfile = {
			id: "iam",
			requires: { jsonOutput: true },
		};
		const candidates = buildTaskCandidates(profile, {
			availableProviders: ["openai", "anthropic"],
			iamAllowedProviders: ["anthropic"],
		});
		for (const c of candidates) {
			expect(c.provider.providerId).toBe("anthropic");
		}
	});

	it("excludes deprecated provider mappings", () => {
		const profile: TaskProfile = {
			id: "deprecated",
			requires: { jsonOutput: true },
		};
		const farFuture = new Date("2999-12-31T00:00:00.000Z");
		const candidates = buildTaskCandidates(profile, {
			availableProviders: ["openai", "anthropic", "google", "azure"],
			now: farFuture,
		});
		for (const c of candidates) {
			if (c.provider.deprecatedAt) {
				expect(farFuture <= c.provider.deprecatedAt).toBe(true);
			}
		}
	});
});

describe("selectModelForTask", () => {
	it("returns null when no candidate satisfies the requirements", () => {
		const profile: TaskProfile = {
			id: "impossible",
			requires: {
				jsonOutput: true,
				reasoning: true,
				vision: true,
				webSearch: true,
			},
		};
		const result = selectModelForTask(profile, {
			availableProviders: [],
		});
		expect(result).toBeNull();
	});

	it("picks the lowest estimated cost candidate", () => {
		const profile: TaskProfile = {
			id: "cheapest",
			requires: { jsonOutput: true },
			expected: { inputTokens: 1000, outputTokens: 200 },
		};
		const result = selectModelForTask(profile, {
			availableProviders: ["openai", "anthropic", "google", "deepseek"],
		});
		expect(result).not.toBeNull();
		const top = result!;
		expect(top.candidates.length).toBeGreaterThan(0);
		expect(top.estimatedCost).toBe(top.candidates[0].estimatedCost);
	});

	it("uses the company_refresh_json builtin profile end-to-end", () => {
		const result = selectModelForTask(
			BUILTIN_TASK_PROFILES.company_refresh_json,
			{
				availableProviders: ["openai", "anthropic", "google", "deepseek"],
			},
		);
		expect(result).not.toBeNull();
		expect(result!.provider.jsonOutput).toBe(true);
		expect(result!.provider.contextSize ?? 0).toBeGreaterThanOrEqual(16_000);
	});
});
