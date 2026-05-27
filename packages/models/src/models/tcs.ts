import type { ModelDefinition } from "@/models.js";

/**
 * Third Culture Systems tier aliases.
 *
 * These are virtual "models" that callers select instead of a concrete
 * provider/model pair. The gateway's existing multi-provider routing picks the
 * cheapest healthy provider mapping and falls back to the next on failure, so
 * each tier doubles as a resilience group.
 *
 * Tier philosophy (revise by editing this file; see whatllm.org/explore):
 *   tcs-cheap       -> bulk classification/extraction at low cost
 *                      (DeepInfra Llama 4 Maverick primary, Gemini fallback)
 *   tcs-balanced    -> default workhorse for most TCS services
 *                      (Gemini Flash Lite primary, DeepInfra Kimi fallback)
 *   tcs-reasoning   -> deeper thinking for complex multi-step tasks
 *                      (DeepInfra Kimi K2.6)
 *   tcs-premium     -> highest quality, large context, world knowledge
 *                      (DeepInfra Kimi K2.6 until Vertex OAuth routing is fixed)
 *   tcs-vision      -> image understanding (receipts, screenshots, diagrams)
 *
 * Routing order within each tier is controlled by listing providers from
 * preferred primary -> fallbacks. Pricing fields are informational; actual
 * billed costs come from the underlying provider mapping. Keep these aliases
 * limited to providers with live, non-placeholder production keys.
 */
export const tcsModels = [
	{
		id: "tcs-cheap",
		name: "TCS Cheap",
		aliases: ["tcs-fast", "tcs-low"],
		description:
			"Third Culture cheap tier: low-cost, fast model for bulk classification, extraction, and short summaries. Primary: Llama 4 Maverick on DeepInfra; fallback: Gemini 3.1 Flash Lite on Google AI Studio.",
		family: "tcs",
		releasedAt: new Date("2026-04-22"),
		providers: [
			{
				providerId: "deepinfra",
				modelName: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
				inputPrice: 0.2 / 1e6,
				cachedInputPrice: 0.04 / 1e6,
				outputPrice: 0.6 / 1e6,
				requestPrice: 0,
				contextSize: 1048576,
				maxOutput: 8192,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "google-ai-studio",
				modelName: "gemini-3.1-flash-lite",
				inputPrice: 0.25 / 1e6,
				cachedInputPrice: 0.025 / 1e6,
				outputPrice: 1.5 / 1e6,
				requestPrice: 0,
				contextSize: 1048576,
				maxOutput: 65536,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
				stability: "beta",
			},
		],
	},
	{
		id: "tcs-balanced",
		name: "TCS Balanced",
		aliases: ["tcs-default"],
		description:
			"Third Culture balanced tier: the default workhorse for most services. Primary: Gemini 3.1 Flash Lite on Google AI Studio; fallback: Kimi K2.6 on DeepInfra.",
		family: "tcs",
		releasedAt: new Date("2026-04-22"),
		providers: [
			{
				providerId: "google-ai-studio",
				modelName: "gemini-3.1-flash-lite",
				inputPrice: 0.25 / 1e6,
				cachedInputPrice: 0.025 / 1e6,
				outputPrice: 1.5 / 1e6,
				requestPrice: 0,
				contextSize: 1048576,
				maxOutput: 65536,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
				stability: "beta",
			},
			{
				providerId: "deepinfra",
				modelName: "moonshotai/Kimi-K2.6",
				inputPrice: 0.75 / 1e6,
				cachedInputPrice: 0.15 / 1e6,
				outputPrice: 3.5 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 16384,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
	{
		id: "tcs-reasoning",
		name: "TCS Reasoning",
		aliases: ["tcs-thinking"],
		description:
			"Third Culture reasoning tier: extended thinking for multi-step agent tasks, evidence verification, and long-form analysis. Primary: Kimi K2.6 on DeepInfra.",
		family: "tcs",
		releasedAt: new Date("2026-04-22"),
		providers: [
			{
				providerId: "deepinfra",
				modelName: "moonshotai/Kimi-K2.6",
				inputPrice: 0.75 / 1e6,
				cachedInputPrice: 0.15 / 1e6,
				outputPrice: 3.5 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 16384,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
	{
		id: "tcs-premium",
		name: "TCS Premium",
		aliases: ["tcs-best"],
		description:
			"Third Culture premium tier: highest available quality with live production keys. Primary: Kimi K2.6 on DeepInfra.",
		family: "tcs",
		releasedAt: new Date("2026-04-22"),
		providers: [
			{
				providerId: "deepinfra",
				modelName: "moonshotai/Kimi-K2.6",
				inputPrice: 0.75 / 1e6,
				cachedInputPrice: 0.15 / 1e6,
				outputPrice: 3.5 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 16384,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
	{
		id: "tcs-vision",
		name: "TCS Vision",
		aliases: ["tcs-multimodal"],
		description:
			"Third Culture vision tier: for tasks that need image understanding (receipts, screenshots, diagrams). Primary: Gemini 3.1 Flash Lite on Google AI Studio; fallback: Kimi K2.6 on DeepInfra.",
		family: "tcs",
		releasedAt: new Date("2026-04-22"),
		providers: [
			{
				providerId: "google-ai-studio",
				modelName: "gemini-3.1-flash-lite",
				inputPrice: 0.25 / 1e6,
				cachedInputPrice: 0.025 / 1e6,
				outputPrice: 1.5 / 1e6,
				requestPrice: 0,
				contextSize: 1048576,
				maxOutput: 65536,
				reasoning: true,
				reasoningMaxTokens: true,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
				stability: "beta",
			},
			{
				providerId: "deepinfra",
				modelName: "moonshotai/Kimi-K2.6",
				inputPrice: 0.75 / 1e6,
				cachedInputPrice: 0.15 / 1e6,
				outputPrice: 3.5 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 16384,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
