import type { ModelDefinition } from "@/models.js";

/**
 * W&B Inference (CoreWeave) catalog — only the models we actually use are
 * pinned here. CoreWeave-backed inference on W&B is unusually cheap for
 * open-weight models, so several of these are referenced from the TCS tier
 * aliases (`tcs.ts`) as primary or fallback providers.
 *
 * Pricing source: https://wandb.ai/site/pricing/inference-/  (May 2026)
 */
export const wandbModels = [
	{
		id: "wandb-deepseek-v4-flash",
		name: "DeepSeek V4 Flash (W&B Inference)",
		aliases: ["deepseek-v4-flash-wandb"],
		description:
			"DeepSeek V4-Flash served on W&B Inference (CoreWeave). 284B MoE / 13B active, 1M context, 384K max output. At $0.01/$0.01 per 1M tokens this is by far the cheapest broadly-capable model in our catalog — used as the primary backend for `tcs-cheap` and `tcs-balanced`.",
		family: "deepseek",
		releasedAt: new Date("2026-04-24"),
		providers: [
			{
				providerId: "wandb",
				modelName: "deepseek-ai/DeepSeek-V4-Flash",
				inputPrice: 0.01 / 1e6,
				outputPrice: 0.01 / 1e6,
				requestPrice: 0,
				contextSize: 1000000,
				maxOutput: 384000,
				streaming: true,
				reasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
				stability: "beta",
			},
		],
	},
	{
		id: "wandb-kimi-k2.6",
		name: "Kimi K2.6 (W&B Inference)",
		aliases: [],
		description:
			"Moonshot AI Kimi K2.6 served on W&B Inference. 262K context, vision-capable. Used as a fallback for `tcs-reasoning`.",
		family: "moonshot",
		releasedAt: new Date("2026-03-15"),
		providers: [
			{
				providerId: "wandb",
				modelName: "moonshotai/Kimi-K2.6",
				inputPrice: 0.95 / 1e6,
				cachedInputPrice: 0.16 / 1e6,
				outputPrice: 4.0 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 32768,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "wandb-qwen3-235b-thinking",
		name: "Qwen3 235B A22B Thinking-2507 (W&B Inference)",
		aliases: [],
		description:
			"Alibaba Qwen3 235B A22B Thinking served on W&B Inference. Strong reasoning at $0.10/$0.10 per 1M tokens — useful as a cheap reasoning fallback.",
		family: "qwen",
		releasedAt: new Date("2025-07-25"),
		providers: [
			{
				providerId: "wandb",
				modelName: "Qwen/Qwen3-235B-A22B-Thinking-2507",
				inputPrice: 0.1 / 1e6,
				outputPrice: 0.1 / 1e6,
				requestPrice: 0,
				contextSize: 262144,
				maxOutput: 32768,
				streaming: true,
				reasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "wandb-glm-5.1",
		name: "Z.AI GLM 5.1 (W&B Inference)",
		aliases: [],
		description:
			"Z.AI GLM 5.1 served on W&B Inference. Used as a cheap premium-tier fallback when Vertex Gemini is unavailable.",
		family: "glm",
		releasedAt: new Date("2026-02-12"),
		providers: [
			{
				providerId: "wandb",
				modelName: "zai-org/GLM-5.1",
				inputPrice: 1.4 / 1e6,
				cachedInputPrice: 0.26 / 1e6,
				outputPrice: 4.4 / 1e6,
				requestPrice: 0,
				contextSize: 200000,
				maxOutput: 32768,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "wandb-llama-4-scout",
		name: "Llama 4 Scout 17Bx16E (W&B Inference)",
		aliases: [],
		description:
			"Meta Llama 4 Scout served on W&B Inference. Cheap multimodal fallback at $0.17/$0.66 per 1M tokens.",
		family: "llama",
		releasedAt: new Date("2025-04-08"),
		providers: [
			{
				providerId: "wandb",
				modelName: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
				inputPrice: 0.17 / 1e6,
				outputPrice: 0.66 / 1e6,
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
