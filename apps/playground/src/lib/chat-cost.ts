import type { ProviderMetadata } from "ai";
import type { UIMessage } from "ai";

export interface PlaygroundMessageMetadata {
	cost?: number;
}

export type PlaygroundChatMessage = UIMessage<PlaygroundMessageMetadata>;

export function extractGatewayCostFromProviderMetadata(
	providerMetadata: ProviderMetadata | undefined,
): number | undefined {
	const usage = (
		providerMetadata as
			| { llmgateway?: { usage?: { cost?: number } } }
			| undefined
	)?.llmgateway?.usage;
	const cost = usage?.cost;
	return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

export function getMessageCost(
	message: PlaygroundChatMessage,
): number | undefined {
	const cost = message.metadata?.cost;
	return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

export function getSessionCost(messages: PlaygroundChatMessage[]): number {
	return messages
		.filter((message) => message.role === "assistant")
		.reduce((sum, message) => sum + (getMessageCost(message) ?? 0), 0);
}

export function formatUsd(cost: number): string {
	if (cost >= 0.01) {
		return `$${cost.toFixed(4)}`;
	}
	if (cost >= 0.0001) {
		return `$${cost.toFixed(6)}`;
	}
	return `$${cost.toFixed(8)}`;
}
