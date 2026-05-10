import type { ModelDefinition } from "@/models.js";

/**
 * A small, verified-working set of DeepInfra-hosted models. DeepInfra's
 * catalog is huge; we only pin models we're actively using. Add more
 * mappings here (or extend existing models in other files with a DeepInfra
 * provider entry) when we want to route specific tiers through DeepInfra.
 */
export const deepinfraModels = [
	{
		id: "deepinfra-llama-3.3-70b-instruct",
		name: "Llama 3.3 70B Instruct (DeepInfra)",
		aliases: [],
		description:
			"Meta Llama 3.3 70B Instruct served on DeepInfra. OpenAI-compatible, cheap, broadly capable — useful as a smoke-test target when other providers are not yet configured.",
		family: "llama",
		releasedAt: new Date("2024-12-06"),
		providers: [
			{
				providerId: "deepinfra",
				modelName: "meta-llama/Llama-3.3-70B-Instruct",
				inputPrice: 0.23 / 1e6,
				cachedInputPrice: 0.04 / 1e6,
				outputPrice: 0.4 / 1e6,
				requestPrice: 0,
				contextSize: 131072,
				maxOutput: 8192,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "deepinfra-llama-4-maverick",
		name: "Llama 4 Maverick 17B (DeepInfra)",
		aliases: [],
		description:
			"Meta Llama 4 Maverick 17B (128E Instruct FP8) served on DeepInfra. Fast and cheap for classification, extraction, and short summaries.",
		family: "llama",
		releasedAt: new Date("2025-04-08"),
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
		],
	},
] as const satisfies ModelDefinition[];
