import { HTTPException } from "hono/http-exception";

import { getProviderHeaders, processImageUrl } from "@llmgateway/actions";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvValue,
	type AvalancheImageRequestBody,
	type ProviderRequestBody,
} from "@llmgateway/models";
import {
	getAvalancheFileUploadBaseUrl,
	getAvalancheJobsApiBaseUrl,
} from "@llmgateway/shared";

const AVALANCHE_IMAGE_POLL_BASE_DELAY_MS = 2000;
const AVALANCHE_IMAGE_POLL_MAX_DELAY_MS = 10000;

interface CompleteAvalancheImageRequestOptions {
	createTaskUrl: string;
	token: string;
	configIndex: number;
	requestBody: ProviderRequestBody;
	signal: AbortSignal;
	maxImageSizeMB: number;
	userPlan: "free" | "pro" | "enterprise" | null;
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function normalizeStatusCode(code: unknown, fallback: number): number {
	if (typeof code !== "number" || !Number.isInteger(code)) {
		return fallback;
	}

	if (code === 455) {
		return 503;
	}
	if (code === 505) {
		return 501;
	}
	if (code >= 400 && code <= 599) {
		return code;
	}

	return fallback;
}

function getErrorMessage(
	body: Record<string, unknown>,
	fallback: string,
): string {
	if (typeof body.msg === "string" && body.msg.length > 0) {
		return body.msg;
	}

	const error =
		body.error && typeof body.error === "object"
			? (body.error as Record<string, unknown>)
			: null;

	if (typeof error?.message === "string" && error.message.length > 0) {
		return error.message;
	}

	if (typeof body.message === "string" && body.message.length > 0) {
		return body.message;
	}

	return fallback;
}

function parseJsonResponse(text: string): Record<string, unknown> {
	if (text.length === 0) {
		return {};
	}

	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return {
			error: {
				message: text,
			},
		};
	}
}

function isAvalancheImageRequestBody(
	requestBody: ProviderRequestBody,
): requestBody is AvalancheImageRequestBody {
	return (
		typeof requestBody === "object" &&
		requestBody !== null &&
		"model" in requestBody &&
		"input" in requestBody &&
		typeof requestBody.model === "string" &&
		typeof requestBody.input === "object" &&
		requestBody.input !== null &&
		"prompt" in requestBody.input &&
		typeof requestBody.input.prompt === "string"
	);
}

function extractTaskId(body: Record<string, unknown>): string | null {
	const data =
		body.data && typeof body.data === "object"
			? (body.data as Record<string, unknown>)
			: null;

	for (const value of [body.taskId, body.task_id, body.id, data?.taskId]) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}

	return null;
}

function extractResultUrls(taskData: Record<string, unknown>): string[] {
	const resultJson =
		typeof taskData.resultJson === "string" && taskData.resultJson.length > 0
			? parseJsonResponse(taskData.resultJson)
			: {};
	const resultUrls = resultJson.resultUrls;
	if (Array.isArray(resultUrls)) {
		return resultUrls.filter(
			(resultUrl): resultUrl is string => typeof resultUrl === "string",
		);
	}

	const response =
		taskData.response && typeof taskData.response === "object"
			? (taskData.response as Record<string, unknown>)
			: null;
	const responseResultUrls = response?.resultUrls;
	if (Array.isArray(responseResultUrls)) {
		return responseResultUrls.filter(
			(resultUrl): resultUrl is string => typeof resultUrl === "string",
		);
	}

	return [];
}

function getAbortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) {
		return signal.reason;
	}

	return new DOMException("Aborted", "AbortError");
}

async function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		throw getAbortError(signal);
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
			reject(getAbortError(signal));
		};

		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function fetchAvalancheJson(
	url: string,
	init: RequestInit,
): Promise<Record<string, unknown>> {
	const response = await fetch(url, init);
	const text = await response.text();
	const body = parseJsonResponse(text);

	if (!response.ok) {
		throw new HTTPException(
			response.status as
				| 400
				| 401
				| 402
				| 403
				| 404
				| 409
				| 422
				| 429
				| 500
				| 501
				| 502
				| 503
				| 504,
			{
				message: getErrorMessage(
					body,
					`Avalanche request failed with status ${response.status}`,
				),
			},
		);
	}

	if (typeof body.code === "number" && body.code !== 200) {
		throw new HTTPException(
			normalizeStatusCode(body.code, 502) as
				| 400
				| 401
				| 402
				| 403
				| 404
				| 409
				| 422
				| 429
				| 500
				| 501
				| 502
				| 503
				| 504,
			{
				message: getErrorMessage(body, "Avalanche request failed"),
			},
		);
	}

	return body;
}

async function uploadAvalancheInputImage(
	createTaskUrl: string,
	token: string,
	configIndex: number,
	imageUrl: string,
	maxImageSizeMB: number,
	userPlan: "free" | "pro" | "enterprise" | null,
	signal: AbortSignal,
): Promise<string> {
	const uploadBaseUrl = getProviderEnvValue(
		"avalanche",
		"fileUploadBaseUrl",
		configIndex,
	);
	const uploadUrl = new URL(
		"/api/file-base64-upload",
		getAvalancheFileUploadBaseUrl(createTaskUrl, uploadBaseUrl),
	).toString();
	const processedImage = await processImageUrl(
		imageUrl,
		process.env.NODE_ENV === "production",
		maxImageSizeMB,
		userPlan,
	);
	const uploadResponse = await fetchAvalancheJson(uploadUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...getProviderHeaders("avalanche", token),
		},
		body: JSON.stringify({
			base64Data: `data:${processedImage.mimeType};base64,${processedImage.data}`,
			uploadPath: "images/input-images",
		}),
		signal,
	});
	const uploadData =
		uploadResponse.data && typeof uploadResponse.data === "object"
			? (uploadResponse.data as Record<string, unknown>)
			: null;
	const fileUrl =
		typeof uploadData?.fileUrl === "string" && uploadData.fileUrl.length > 0
			? uploadData.fileUrl
			: null;
	const downloadUrl =
		typeof uploadData?.downloadUrl === "string" &&
		uploadData.downloadUrl.length > 0
			? uploadData.downloadUrl
			: null;
	const uploadedUrl = fileUrl ?? downloadUrl;

	if (!uploadedUrl) {
		throw new HTTPException(502, {
			message: "Avalanche image upload did not return a usable file URL",
		});
	}

	return uploadedUrl;
}

export async function completeAvalancheImageRequest({
	createTaskUrl,
	token,
	configIndex,
	requestBody,
	signal,
	maxImageSizeMB,
	userPlan,
}: CompleteAvalancheImageRequestOptions): Promise<Response> {
	try {
		if (!isAvalancheImageRequestBody(requestBody)) {
			return jsonResponse(
				{
					error: {
						message:
							"Avalanche image request body was not in the expected format",
					},
				},
				500,
			);
		}

		const uploadedInputs =
			requestBody.input.image_input && requestBody.input.image_input.length > 0
				? await Promise.all(
						requestBody.input.image_input.map((imageUrl) =>
							uploadAvalancheInputImage(
								createTaskUrl,
								token,
								configIndex,
								imageUrl,
								maxImageSizeMB,
								userPlan,
								signal,
							),
						),
					)
				: [];
		const createTaskBody = {
			...requestBody,
			input: {
				...requestBody.input,
				...(uploadedInputs.length > 0 ? { image_input: uploadedInputs } : {}),
			},
		} satisfies AvalancheImageRequestBody;

		const createResponse = await fetchAvalancheJson(createTaskUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...getProviderHeaders("avalanche", token),
			},
			body: JSON.stringify(createTaskBody),
			signal,
		});
		const taskId = extractTaskId(createResponse);

		if (!taskId) {
			return jsonResponse(
				{
					error: {
						message: "Avalanche image response did not include a task id",
					},
				},
				502,
			);
		}

		const pollBaseUrl = getAvalancheJobsApiBaseUrl(createTaskUrl);
		const pollUrl = new URL(
			"recordInfo",
			pollBaseUrl.endsWith("/") ? pollBaseUrl : `${pollBaseUrl}/`,
		);
		pollUrl.searchParams.set("taskId", taskId);

		let delayMs = AVALANCHE_IMAGE_POLL_BASE_DELAY_MS;
		for (;;) {
			const pollResponse = await fetchAvalancheJson(pollUrl.toString(), {
				method: "GET",
				headers: getProviderHeaders("avalanche", token),
				signal,
			});
			const taskData =
				pollResponse.data && typeof pollResponse.data === "object"
					? (pollResponse.data as Record<string, unknown>)
					: null;

			if (!taskData) {
				return jsonResponse(
					{
						error: {
							message: "Avalanche polling response did not include task data",
						},
					},
					502,
				);
			}

			switch (taskData.state) {
				case "waiting":
				case "queuing":
				case "generating":
					await sleepWithSignal(delayMs, signal);
					delayMs = Math.min(
						AVALANCHE_IMAGE_POLL_MAX_DELAY_MS,
						Math.round(delayMs * 1.5),
					);
					continue;
				case "success": {
					const resultUrls = extractResultUrls(taskData);
					if (resultUrls.length === 0) {
						return jsonResponse(
							{
								error: {
									message:
										"Avalanche image task completed without any result URLs",
								},
							},
							502,
						);
					}

					return jsonResponse(
						{
							created: Math.floor(Date.now() / 1000),
							data: resultUrls.map((url) => ({ url })),
							avalanche_task_id: taskId,
							avalanche_task_state: taskData.state,
						},
						200,
					);
				}
				case "fail": {
					const failCode =
						typeof taskData.failCode === "string"
							? Number(taskData.failCode)
							: typeof taskData.failCode === "number"
								? taskData.failCode
								: 501;

					return jsonResponse(
						{
							error: {
								message:
									typeof taskData.failMsg === "string" &&
									taskData.failMsg.length > 0
										? taskData.failMsg
										: "Avalanche image generation failed",
							},
						},
						normalizeStatusCode(failCode, 501),
					);
				}
				default:
					logger.warn("Avalanche image polling returned an unknown state", {
						taskId,
						state: taskData.state,
					});
					return jsonResponse(
						{
							error: {
								message: "Avalanche image polling returned an unknown state",
							},
						},
						502,
					);
			}
		}
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === "AbortError" || error.name === "TimeoutError")
		) {
			throw error;
		}

		if (error instanceof HTTPException) {
			return jsonResponse(
				{
					error: {
						message: error.message,
					},
				},
				error.status,
			);
		}

		throw error;
	}
}
