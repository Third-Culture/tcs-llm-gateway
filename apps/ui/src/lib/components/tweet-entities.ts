import type { Tweet } from "react-tweet/api";

/**
 * `react-tweet`'s `enrichTweet()` assumes `entities.hashtags`, `.urls`,
 * `.symbols`, and `.user_mentions` are always arrays and iterates them
 * directly (see `getEntities`/`addEntities` in `react-tweet`'s `utils.js`).
 * Twitter's syndication API (used by `fetchTweet`) omits any of those keys
 * entirely when a tweet has none of that entity type, so `enrichTweet` throws
 * `TypeError: entities.hashtags is not iterable` for the vast majority of
 * real tweets (confirmed against live tweet IDs used on the landing/auth
 * pages - every one of them was missing at least one of these keys).
 *
 * Normalize the shape before enriching so real tweet data renders instead of
 * silently falling back to "Tweet not found" and logging an ERROR on every
 * page render that includes a tweet card.
 */
export function normalizeTweetEntities(tweet: Tweet): Tweet {
	const normalizeEntities = <T extends { entities: Tweet["entities"] }>(
		t: T,
	): T => ({
		...t,
		entities: {
			...t.entities,
			hashtags: t.entities?.hashtags ?? [],
			urls: t.entities?.urls ?? [],
			user_mentions: t.entities?.user_mentions ?? [],
			symbols: t.entities?.symbols ?? [],
		},
	});

	const normalized = normalizeEntities(tweet);
	return normalized.quoted_tweet
		? {
				...normalized,
				quoted_tweet: normalizeEntities(normalized.quoted_tweet),
			}
		: normalized;
}
