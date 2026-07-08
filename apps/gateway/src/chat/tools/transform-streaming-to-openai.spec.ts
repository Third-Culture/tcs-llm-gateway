import { describe, expect, it, vi } from "vitest";

import { transformStreamingToOpenai } from "./transform-streaming-to-openai.js";

const { warn, error, debug } = vi.hoisted(() => ({
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
}));

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		setex: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn,
		error,
		debug,
		info: vi.fn(),
	},
}));

describe("transformStreamingToOpenai", () => {
	it("ignores OpenAI keepalive events without warning", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"openai",
			"gpt-5-mini",
			{
				type: "keepalive",
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it.each(["response.content_part.done", "response.output_text.done"])(
		"treats %s as a handled OpenAI Responses terminal event",
		(eventType) => {
			warn.mockClear();

			const result = transformStreamingToOpenai(
				"openai",
				"gpt-5-mini",
				{
					type: eventType,
					response: {
						id: "resp_123",
						created_at: 1234567890,
						model: "gpt-5-mini",
					},
				},
				[],
			);

			expect(result).toMatchObject({
				id: "resp_123",
				object: "chat.completion.chunk",
				created: 1234567890,
				model: "gpt-5-mini",
				choices: [
					{
						index: 0,
						delta: { role: "assistant" },
						finish_reason: null,
					},
				],
				usage: null,
			});
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it("maps AWS Bedrock reasoning deltas to OpenAI reasoning chunks", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					reasoningContent: {
						text: "Need to compare the constraints first.",
					},
				},
			},
			[],
		);

		expect(result).toMatchObject({
			object: "chat.completion.chunk",
			model: "anthropic.claude-sonnet-4-6",
			choices: [
				{
					index: 0,
					delta: {
						reasoning: "Need to compare the constraints first.",
						role: "assistant",
					},
					finish_reason: null,
				},
			],
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("treats non-text AWS Bedrock contentBlockDelta members as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					reasoningContent: {
						signature: "sig_123",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("treats known AWS Bedrock citation deltas as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					citation: {
						title: "Example citation",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns on unknown AWS Bedrock contentBlockDelta members", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockDelta",
				contentBlockIndex: 0,
				delta: {
					SDK_UNKNOWN_MEMBER: {
						name: "futureDelta",
					},
				},
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			"[streaming] Unrecognized AWS Bedrock event type",
			expect.objectContaining({
				provider: "aws-bedrock",
				model: "anthropic.claude-sonnet-4-6",
				eventType: "contentBlockDelta",
			}),
		);
	});

	it("treats AWS Bedrock contentBlockStop as handled", () => {
		warn.mockClear();

		const result = transformStreamingToOpenai(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			{
				__aws_event_type: "contentBlockStop",
				contentBlockIndex: 0,
			},
			[],
		);

		expect(result).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	it.each(["deepinfra", "wandb"] as const)(
		"remaps end_turn to stop for %s provider without warning",
		(provider) => {
			warn.mockClear();

			const result = transformStreamingToOpenai(
				provider,
				"some-model",
				{
					id: "chatcmpl-123",
					object: "chat.completion.chunk",
					created: 1234567890,
					model: "some-model",
					choices: [
						{
							index: 0,
							delta: { content: "" },
							finish_reason: "end_turn",
						},
					],
				},
				[],
			);

			expect(result?.choices?.[0]?.finish_reason).toBe("stop");
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it.each(["deepinfra", "wandb"] as const)(
		"remaps tool_use to tool_calls for %s provider without warning",
		(provider) => {
			warn.mockClear();

			const result = transformStreamingToOpenai(
				provider,
				"some-model",
				{
					id: "chatcmpl-123",
					object: "chat.completion.chunk",
					created: 1234567890,
					model: "some-model",
					choices: [
						{
							index: 0,
							delta: { content: "" },
							finish_reason: "tool_use",
						},
					],
				},
				[],
			);

			expect(result?.choices?.[0]?.finish_reason).toBe("tool_calls");
			expect(warn).not.toHaveBeenCalled();
		},
	);

	it.each(["google-ai-studio", "glacier", "google-vertex", "quartz"] as const)(
		"does not log at error level for %s usage-only chunks without candidates",
		(provider) => {
			error.mockClear();
			debug.mockClear();
			warn.mockClear();

			const result = transformStreamingToOpenai(
				provider,
				"gemini-2.5-flash",
				{
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 20,
						totalTokenCount: 30,
					},
				},
				[{ role: "user", content: "hello" }],
			);

			expect(error).not.toHaveBeenCalled();
			expect(debug).toHaveBeenCalledWith(
				"[transform-streaming-to-openai] Google streaming chunk missing candidates",
				expect.objectContaining({
					hasCandidates: false,
				}),
			);
			expect(result).toMatchObject({
				object: "chat.completion.chunk",
				choices: [
					{ index: 0, delta: { role: "assistant" }, finish_reason: null },
				],
			});
		},
	);

	it.each(["google-ai-studio", "glacier", "google-vertex", "quartz"] as const)(
		"does not log at error level for %s chunks with empty candidates array",
		(provider) => {
			error.mockClear();
			debug.mockClear();

			transformStreamingToOpenai(
				provider,
				"gemini-2.5-flash",
				{
					candidates: [],
					usageMetadata: {
						promptTokenCount: 5,
						candidatesTokenCount: 0,
						totalTokenCount: 5,
					},
				},
				[],
			);

			expect(error).not.toHaveBeenCalled();
			expect(debug).toHaveBeenCalled();
		},
	);
});
