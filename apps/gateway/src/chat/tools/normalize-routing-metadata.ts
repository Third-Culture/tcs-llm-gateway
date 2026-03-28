import type { RoutingMetadata } from "@llmgateway/actions";

export function normalizeRoutingMetadataForLogging(
	metadata: RoutingMetadata,
): RoutingMetadata {
	if (metadata.selectionReason !== "price-only-no-metrics") {
		return metadata;
	}

	const providerScoreCounts = new Map<string, number>();

	for (const score of metadata.providerScores) {
		providerScoreCounts.set(
			score.providerId,
			(providerScoreCounts.get(score.providerId) ?? 0) + 1,
		);
	}

	return {
		...metadata,
		providerScores: metadata.providerScores.map((score) =>
			(providerScoreCounts.get(score.providerId) ?? 0) > 1
				? score
				: {
						...score,
						region: undefined,
					},
		),
	};
}
