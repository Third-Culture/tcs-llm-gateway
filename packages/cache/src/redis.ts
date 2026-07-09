import { Redis } from "ioredis";

import { logger } from "@llmgateway/logger";

export const redisClient = new Redis({
	host: process.env.REDIS_HOST ?? "localhost",
	port: Number(process.env.REDIS_PORT) || 6379,
	password: process.env.REDIS_PASSWORD,
});

redisClient.on("error", (err) => logger.warn("Redis Client Error", err));

export const LOG_QUEUE = "log_queue_" + process.env.NODE_ENV;

export async function publishToQueue(
	queue: string,
	message: unknown,
): Promise<void> {
	try {
		await redisClient.lpush(queue, JSON.stringify(message));
	} catch (error) {
		const msg = message as Record<string, unknown> | undefined;
		const item = msg
			? {
					requestId: msg.requestId,
					organizationId: msg.organizationId,
					projectId: msg.projectId,
					usedModel: msg.usedModel,
					usedProvider: msg.usedProvider,
				}
			: undefined;
		logger.warn("Error publishing to queue", {
			err: error instanceof Error ? error : new Error(String(error)),
			queue,
			item,
		});
		throw error;
	}
}

export async function consumeFromQueue(
	queue: string,
	count = 100,
): Promise<string[] | null> {
	try {
		const result = await redisClient.lpop(queue, count);

		if (!result) {
			return null;
		}

		return result;
	} catch (error) {
		logger.warn(
			"Error consuming from queue",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

export async function closeRedisClient(): Promise<void> {
	try {
		await redisClient.disconnect();
		logger.info("Redis client disconnected");
	} catch (error) {
		logger.warn(
			"Error disconnecting Redis client",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
