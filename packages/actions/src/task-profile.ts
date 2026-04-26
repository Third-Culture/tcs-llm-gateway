import {
	getProviderDefinition,
	models,
	type ModelDefinition,
	type ProviderModelMapping,
	type StabilityLevel,
} from "@llmgateway/models";

/**
 * A typed routing profile that describes the requirements and expected token
 * shape for a task. The router uses this to filter the model catalog to the
 * candidates that can actually do the task, then ranks the survivors by
 * estimated workload cost rather than the rough `(input + output) / 2`
 * heuristic that pure auto-routing falls back to.
 *
 * Keep this small and explicit. Profiles are an ecosystem-wide contract:
 * adding a field is a breaking change for downstream callers.
 */
export interface TaskProfile {
	/**
	 * Stable identifier for the task (e.g. "company_refresh_json"). Echoed
	 * into routing metadata for observability so it is easy to answer
	 * "which task ran on which model" in production logs.
	 */
	id: string;
	/**
	 * Hard capability requirements. A candidate model/provider mapping is
	 * dropped if any required capability is missing. These map directly onto
	 * the provider mapping flags defined in `@llmgateway/models`.
	 */
	requires?: {
		jsonOutput?: boolean;
		jsonOutputSchema?: boolean;
		tools?: boolean;
		webSearch?: boolean;
		vision?: boolean;
		reasoning?: boolean;
	};
	/**
	 * Hard capacity requirements. Candidates with smaller context windows or
	 * output limits are dropped.
	 */
	limits?: {
		minContextSize?: number;
		minMaxOutput?: number;
	};
	/**
	 * Expected token shape for the task, used to estimate workload cost.
	 * Both fields are optional. If provided, estimated cost is computed as
	 * `inputPrice * expectedInputTokens + outputPrice * expectedOutputTokens
	 * + (requestPrice ?? 0)`. When absent the existing
	 * `(inputPrice + outputPrice) / 2` heuristic is used.
	 */
	expected?: {
		inputTokens?: number;
		outputTokens?: number;
	};
	/**
	 * Optional pricing caps. Candidates with prices above the cap are
	 * dropped. Useful for IAM-style budget guardrails per task.
	 */
	pricing?: {
		maxInputPricePerToken?: number;
		maxOutputPricePerToken?: number;
		maxEstimatedCost?: number;
	};
	/**
	 * Optional list of model id allow/deny rules. When `allow` is provided,
	 * only listed models are considered. `deny` is applied after `allow`.
	 */
	models?: {
		allow?: string[];
		deny?: string[];
	};
	/**
	 * Optional list of provider id allow/deny rules.
	 */
	providers?: {
		allow?: string[];
		deny?: string[];
	};
	/**
	 * Quality floor. When set, deprioritises models whose family is not in
	 * the floor's family list. We intentionally avoid encoding a global
	 * quality score; routing is based on capability + estimated cost. The
	 * floor is advisory and only used to break ties and to avoid surprising
	 * downgrades for high-stakes tasks.
	 *
	 * - "low": cheap, short tasks (e.g. classification, extraction)
	 * - "medium": balanced (e.g. structured generation, drafting)
	 * - "high": careful tasks (long reasoning, agents)
	 */
	qualityFloor?: "low" | "medium" | "high";
}

export interface ProviderCandidate {
	model: ModelDefinition;
	provider: ProviderModelMapping;
	estimatedCost: number;
	priority: number;
	stability: StabilityLevel;
}

export interface TaskSelectionContext {
	/**
	 * Provider ids that are usable by the caller. Only candidates whose
	 * provider id is in this set survive. Mirrors the existing
	 * `availableProviders` computation in `chat.ts`.
	 */
	availableProviders: string[];
	/**
	 * Optional IAM-allowed provider list. When provided, candidates whose
	 * provider id is not in the list are dropped.
	 */
	iamAllowedProviders?: string[];
	/**
	 * Whether the request asks for free models only (e.g. the
	 * `free_models_only` flag). When true, only models with `free: true`
	 * survive.
	 */
	freeModelsOnly?: boolean;
	/**
	 * When true, models with provider mappings flagged as `reasoning: true`
	 * are excluded. Mirrors the `no_reasoning` request flag.
	 */
	noReasoning?: boolean;
	/**
	 * Used to filter out deprecated provider mappings. Defaults to `new Date()`.
	 */
	now?: Date;
}

export interface TaskSelection {
	model: ModelDefinition;
	provider: ProviderModelMapping;
	estimatedCost: number;
	candidates: ProviderCandidate[];
	reason: string;
}

const FAMILY_QUALITY_FLOOR: Record<"low" | "medium" | "high", string[]> = {
	low: [],
	medium: [
		"openai",
		"anthropic",
		"google",
		"deepseek",
		"mistral",
		"meta",
		"xai",
		"alibaba",
	],
	high: ["openai", "anthropic", "google"],
};

/**
 * Builtin profiles for the Greshi-style workloads described in the
 * production routing plan. These are ecosystem defaults; callers may pass
 * a fully-custom profile inline instead.
 */
export const BUILTIN_TASK_PROFILES: Record<string, TaskProfile> = {
	company_refresh_json: {
		id: "company_refresh_json",
		requires: {
			jsonOutput: true,
		},
		limits: {
			minContextSize: 16_000,
			minMaxOutput: 1024,
		},
		expected: {
			inputTokens: 1500,
			outputTokens: 600,
		},
		qualityFloor: "medium",
	},
	deck_style_check: {
		id: "deck_style_check",
		requires: {
			jsonOutput: true,
		},
		limits: {
			minContextSize: 32_000,
			minMaxOutput: 2048,
		},
		expected: {
			inputTokens: 6000,
			outputTokens: 1500,
		},
		qualityFloor: "medium",
	},
	news_analysis: {
		id: "news_analysis",
		requires: {
			jsonOutput: true,
		},
		limits: {
			minContextSize: 8000,
			minMaxOutput: 512,
		},
		expected: {
			inputTokens: 1200,
			outputTokens: 400,
		},
		qualityFloor: "low",
	},
};

/**
 * Resolve a task profile input. Accepts either a builtin id or a full
 * profile object. Returns `undefined` for `undefined` input so callers can
 * pass through optional values cleanly.
 */
export function resolveTaskProfile(
	input: string | TaskProfile | undefined,
): TaskProfile | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (typeof input === "string") {
		const builtin = BUILTIN_TASK_PROFILES[input];
		if (!builtin) {
			throw new Error(
				`Unknown task profile id: "${input}". Known ids: ${Object.keys(
					BUILTIN_TASK_PROFILES,
				).join(", ")}`,
			);
		}
		return builtin;
	}
	if (!input.id) {
		throw new Error(`Task profile must include a non-empty "id".`);
	}
	return input;
}

function isProviderMappingDeprecated(
	mapping: ProviderModelMapping,
	now: Date,
): boolean {
	if (mapping.deactivatedAt && now > mapping.deactivatedAt) {
		return true;
	}
	if (mapping.deprecatedAt && now > mapping.deprecatedAt) {
		return true;
	}
	return false;
}

function effectiveStability(
	model: ModelDefinition,
	mapping: ProviderModelMapping,
): StabilityLevel {
	const providerStab = mapping.stability;
	const modelStab = model.stability;
	const stab = providerStab ?? modelStab ?? "stable";
	return stab;
}

function meetsCapabilities(
	mapping: ProviderModelMapping,
	profile: TaskProfile,
): boolean {
	const req = profile.requires;
	if (!req) {
		return true;
	}
	if (req.jsonOutput && mapping.jsonOutput !== true) {
		return false;
	}
	if (req.jsonOutputSchema && mapping.jsonOutputSchema !== true) {
		return false;
	}
	if (req.tools && mapping.tools !== true) {
		return false;
	}
	if (req.webSearch && mapping.webSearch !== true) {
		return false;
	}
	if (req.vision && mapping.vision !== true) {
		return false;
	}
	if (req.reasoning && mapping.reasoning !== true) {
		return false;
	}
	return true;
}

function meetsLimits(
	mapping: ProviderModelMapping,
	profile: TaskProfile,
): boolean {
	const limits = profile.limits;
	if (!limits) {
		return true;
	}
	if (
		limits.minContextSize !== undefined &&
		(mapping.contextSize ?? 0) < limits.minContextSize
	) {
		return false;
	}
	if (
		limits.minMaxOutput !== undefined &&
		(mapping.maxOutput ?? 0) < limits.minMaxOutput
	) {
		return false;
	}
	return true;
}

function meetsPricing(
	mapping: ProviderModelMapping,
	profile: TaskProfile,
): boolean {
	const pricing = profile.pricing;
	if (!pricing) {
		return true;
	}
	if (
		pricing.maxInputPricePerToken !== undefined &&
		(mapping.inputPrice ?? 0) > pricing.maxInputPricePerToken
	) {
		return false;
	}
	if (
		pricing.maxOutputPricePerToken !== undefined &&
		(mapping.outputPrice ?? 0) > pricing.maxOutputPricePerToken
	) {
		return false;
	}
	return true;
}

function passesFamilyFloor(
	model: ModelDefinition,
	profile: TaskProfile,
): boolean {
	const floor = profile.qualityFloor;
	if (!floor) {
		return true;
	}
	const families = FAMILY_QUALITY_FLOOR[floor];
	if (families.length === 0) {
		return true;
	}
	return families.includes(model.family);
}

/**
 * Compute the estimated cost for a single provider mapping under a task
 * profile. Falls back to the legacy `(input + output) / 2` heuristic when
 * `expected` is missing.
 */
export function estimateTaskCost(
	mapping: ProviderModelMapping,
	profile: TaskProfile,
): number {
	const discount = mapping.discount ?? 0;
	const discountMultiplier = 1 - discount;
	const inputPrice = mapping.inputPrice ?? 0;
	const outputPrice = mapping.outputPrice ?? 0;
	const requestPrice = mapping.requestPrice ?? 0;
	const expected = profile.expected;

	if (
		expected !== undefined &&
		(expected.inputTokens !== undefined || expected.outputTokens !== undefined)
	) {
		const inputCost = inputPrice * (expected.inputTokens ?? 0);
		const outputCost = outputPrice * (expected.outputTokens ?? 0);
		return (inputCost + outputCost + requestPrice) * discountMultiplier;
	}

	if (inputPrice > 0 || outputPrice > 0) {
		return ((inputPrice + outputPrice) / 2) * discountMultiplier;
	}
	if (requestPrice > 0) {
		return requestPrice * discountMultiplier;
	}
	return 0;
}

/**
 * Build the ranked candidate list for a task profile.
 *
 * Filters by capability, capacity, pricing caps, IAM, project availability,
 * deprecation, stability, free flag, no-reasoning flag, and explicit allow/
 * deny lists. Ranks survivors by estimated cost ascending, then by provider
 * priority descending.
 */
export function buildTaskCandidates(
	profile: TaskProfile,
	context: TaskSelectionContext,
): ProviderCandidate[] {
	const now = context.now ?? new Date();
	const allowModels = profile.models?.allow;
	const denyModels = profile.models?.deny;
	const allowProviders = profile.providers?.allow;
	const denyProviders = profile.providers?.deny;
	const candidates: ProviderCandidate[] = [];

	for (const model of models) {
		if (model.id === "auto" || model.id === "custom") {
			continue;
		}
		if (allowModels && !allowModels.includes(model.id)) {
			continue;
		}
		if (denyModels && denyModels.includes(model.id)) {
			continue;
		}
		if (context.freeModelsOnly && !("free" in model && model.free)) {
			continue;
		}
		if (!passesFamilyFloor(model, profile)) {
			continue;
		}

		for (const mapping of model.providers as ProviderModelMapping[]) {
			if (allowProviders && !allowProviders.includes(mapping.providerId)) {
				continue;
			}
			if (denyProviders && denyProviders.includes(mapping.providerId)) {
				continue;
			}
			if (!context.availableProviders.includes(mapping.providerId)) {
				continue;
			}
			if (
				context.iamAllowedProviders &&
				!context.iamAllowedProviders.includes(mapping.providerId)
			) {
				continue;
			}
			if (isProviderMappingDeprecated(mapping, now)) {
				continue;
			}
			const stab = effectiveStability(model, mapping);
			if (stab === "unstable" || stab === "experimental") {
				continue;
			}
			if (context.noReasoning && mapping.reasoning === true) {
				continue;
			}
			if (!meetsCapabilities(mapping, profile)) {
				continue;
			}
			if (!meetsLimits(mapping, profile)) {
				continue;
			}
			if (!meetsPricing(mapping, profile)) {
				continue;
			}

			const estimatedCost = estimateTaskCost(mapping, profile);
			if (
				profile.pricing?.maxEstimatedCost !== undefined &&
				estimatedCost > profile.pricing.maxEstimatedCost
			) {
				continue;
			}

			const providerDef = getProviderDefinition(mapping.providerId);
			const priority = providerDef?.priority ?? 1;

			candidates.push({
				model,
				provider: mapping,
				estimatedCost,
				priority,
				stability: stab,
			});
		}
	}

	candidates.sort((a, b) => {
		if (a.estimatedCost !== b.estimatedCost) {
			return a.estimatedCost - b.estimatedCost;
		}
		return b.priority - a.priority;
	});

	return candidates;
}

/**
 * Pick the best (model, provider) pair for a task profile or return null
 * when no candidate satisfies the requirements. The caller is expected to
 * still go through the full provider-scoring path
 * (`getCheapestFromAvailableProviders`) for region/uptime selection within
 * the selected model.
 */
export function selectModelForTask(
	profile: TaskProfile,
	context: TaskSelectionContext,
): TaskSelection | null {
	const candidates = buildTaskCandidates(profile, context);
	if (candidates.length === 0) {
		return null;
	}
	const top = candidates[0];
	return {
		model: top.model,
		provider: top.provider,
		estimatedCost: top.estimatedCost,
		candidates,
		reason: "task-profile-cheapest",
	};
}
