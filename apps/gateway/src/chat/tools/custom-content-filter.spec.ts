import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@llmgateway/logger";

import { checkCustomContentFilter } from "./custom-content-filter.js";

describe("checkCustomContentFilter", () => {
	const originalApiKey = process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY;
	const originalModel = process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL;
	const originalCustomBaseUrl = process.env.LLM_CONTENT_FILTER_CUSTOM_BASE_URL;
	const originalGatewayUrl = process.env.GATEWAY_URL;

	afterEach(() => {
		vi.restoreAllMocks();

		if (originalApiKey === undefined) {
			delete process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY;
		} else {
			process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY = originalApiKey;
		}

		if (originalModel === undefined) {
			delete process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL;
		} else {
			process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL = originalModel;
		}

		if (originalCustomBaseUrl === undefined) {
			delete process.env.LLM_CONTENT_FILTER_CUSTOM_BASE_URL;
		} else {
			process.env.LLM_CONTENT_FILTER_CUSTOM_BASE_URL = originalCustomBaseUrl;
		}

		if (originalGatewayUrl === undefined) {
			delete process.env.GATEWAY_URL;
		} else {
			process.env.GATEWAY_URL = originalGatewayUrl;
		}
	});

	it("calls llmgateway chat completions with the configured key and model", async () => {
		process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY = "custom-api-key";
		process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL = "anthropic/claude-sonnet-4-5";
		process.env.GATEWAY_URL = "https://gateway.example.com/v1";

		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				expect(url).toBe("https://gateway.example.com/v1/chat/completions");

				const headers = new Headers(init?.headers);
				expect(headers.get("authorization")).toBe("Bearer custom-api-key");
				expect(headers.get("x-client-request-id")).toBe("request-id");

				const body = JSON.parse(String(init?.body ?? "{}"));
				expect(body.model).toBe("anthropic/claude-sonnet-4-5");
				expect(body.temperature).toBe(0);
				expect(body.max_tokens).toBe(300);
				expect(body.response_format).toEqual({
					type: "json_schema",
					json_schema: expect.objectContaining({
						name: "gateway_content_filter",
						strict: true,
					}),
				});
				expect(body.plugins).toEqual([{ id: "response-healing" }]);
				expect(body.messages[0]?.role).toBe("system");
				expect(body.messages[1]?.content).toContain(
					"I want to attack someone.",
				);

				return new Response(
					JSON.stringify({
						id: "chatcmpl-moderation",
						model: "anthropic/claude-sonnet-4-5",
						choices: [
							{
								message: {
									content: JSON.stringify({
										flagged: true,
										categories: {
											violence: true,
										},
										category_scores: {
											violence: 0.93,
										},
										reason: "Threatening violence.",
									}),
								},
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "upstream-custom-request-id",
						},
					},
				);
			});

		const result = await checkCustomContentFilter(
			[
				{
					role: "user",
					content: "I want to attack someone.",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(fetchSpy).toHaveBeenCalledOnce();
		expect(result.flagged).toBe(true);
		expect(result.model).toBe("anthropic/claude-sonnet-4-5");
		expect(result.upstreamRequestId).toBe("upstream-custom-request-id");
		expect(result.responses).toEqual([
			{
				id: "chatcmpl-moderation",
				model: "anthropic/claude-sonnet-4-5",
				results: [
					{
						flagged: true,
						categories: {
							violence: true,
						},
						category_scores: {
							violence: 0.93,
						},
						reason: "Threatening violence.",
					},
				],
			},
		]);
	});

	it("uses the custom base url override when configured", async () => {
		process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY = "custom-api-key";
		process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL = "anthropic/claude-sonnet-4-5";
		process.env.LLM_CONTENT_FILTER_CUSTOM_BASE_URL =
			"https://moderation.example.com/internal/v1";
		process.env.GATEWAY_URL = "https://gateway.example.com/v1";

		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl-moderation",
					model: "anthropic/claude-sonnet-4-5",
					choices: [
						{
							message: {
								content: JSON.stringify({
									flagged: false,
									categories: {
										violence: false,
									},
									category_scores: {
										violence: 0.02,
									},
									reason: "Safe.",
								}),
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "upstream-custom-request-id",
					},
				},
			),
		);

		await checkCustomContentFilter(
			[
				{
					role: "user",
					content: "Hello!",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://moderation.example.com/internal/v1/chat/completions",
			expect.any(Object),
		);
	});

	it("parses JSON verdicts wrapped in code fences", async () => {
		process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY = "custom-api-key";
		process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL = "openai/gpt-5-mini";
		process.env.GATEWAY_URL = "https://gateway.example.com";

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl-moderation",
					model: "openai/gpt-5-mini",
					choices: [
						{
							message: {
								content:
									'```json\n{"flagged":false,"categories":{"violence":false},"category_scores":{"violence":0.12},"reason":"Safe."}\n```',
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "upstream-custom-request-id",
					},
				},
			),
		);

		const result = await checkCustomContentFilter(
			[
				{
					role: "user",
					content: "Hello!",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.flagged).toBe(false);
		expect(result.responses[0]?.results?.[0]?.category_scores).toEqual({
			violence: 0.12,
		});
	});

	it("fails open when custom moderation config is missing", async () => {
		delete process.env.LLM_CONTENT_FILTER_CUSTOM_API_KEY;
		delete process.env.LLM_CONTENT_FILTER_CUSTOM_MODEL;
		process.env.GATEWAY_URL = "https://gateway.example.com";

		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

		const result = await checkCustomContentFilter(
			[
				{
					role: "user",
					content: "Hello!",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.flagged).toBe(false);
		expect(result.responses).toEqual([]);
		expect(errorSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				mode: "custom",
				requestId: "request-id",
				error:
					"LLM_CONTENT_FILTER_CUSTOM_API_KEY environment variable is required for custom content filter",
			}),
			expect.any(Error),
		);
	});
});
