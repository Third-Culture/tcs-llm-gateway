import { describe, it, expect } from "vitest";

import { normalizeTweetEntities } from "./tweet-entities";

import type { Tweet } from "react-tweet/api";

function buildTweet(entities: Partial<Tweet["entities"]>): Tweet {
	return {
		entities: entities as Tweet["entities"],
	} as Tweet;
}

/**
 * A faithful, minimal copy of the vulnerable snippet from `react-tweet`'s
 * `utils.js` (`getEntities`), which is what actually throws in production:
 *
 *   addEntities(result, 'hashtag', tweet.entities.hashtags);
 *   ...
 *   function addEntities(result, type, entities) {
 *     for (const entity of entities) { ... }
 *   }
 *
 * This documents/pins the exact upstream failure mode without requiring an
 * import of the real `react-tweet` package, whose default export pulls in
 * CSS modules that Vitest's Node environment can't load.
 */
function assertEntitiesAreIterable(entities: Tweet["entities"]) {
	for (const _ of entities.hashtags) {
		// no-op, only iterating to reproduce the upstream crash site
	}
	for (const _ of entities.urls) {
		// no-op
	}
	for (const _ of entities.user_mentions) {
		// no-op
	}
	for (const _ of entities.symbols) {
		// no-op
	}
}

describe("normalizeTweetEntities", () => {
	it("documents that real-world syndication API tweets crash react-tweet's enrichTweet", () => {
		// Confirmed against live tweet IDs used on the landing/login/signup
		// pages: Twitter's syndication API omits `hashtags`/`urls`/`symbols`
		// entirely when a tweet has none of that type, e.g.
		// `{ entities: { user_mentions: [...] } }`.
		const rawEntitiesFromTwitterApi = {
			user_mentions: [],
		} as unknown as Tweet["entities"];

		expect(() => assertEntitiesAreIterable(rawEntitiesFromTwitterApi)).toThrow(
			/not iterable/,
		);
	});

	it("fills in missing entity arrays so the result is always iterable", () => {
		const tweet = buildTweet({ user_mentions: [] });

		const normalized = normalizeTweetEntities(tweet);

		expect(() => assertEntitiesAreIterable(normalized.entities)).not.toThrow();
		expect(normalized.entities).toEqual({
			hashtags: [],
			urls: [],
			user_mentions: [],
			symbols: [],
		});
	});

	it("preserves entity arrays that are already present", () => {
		const urls: Tweet["entities"]["urls"] = [
			{
				display_url: "example.com",
				expanded_url: "https://example.com",
				indices: [0, 10],
				url: "https://t.co/abc",
			},
		];
		const tweet = buildTweet({ urls });

		const normalized = normalizeTweetEntities(tweet);

		expect(normalized.entities.urls).toBe(urls);
		expect(normalized.entities.hashtags).toEqual([]);
		expect(normalized.entities.symbols).toEqual([]);
		expect(normalized.entities.user_mentions).toEqual([]);
	});

	it("normalizes a quoted tweet's entities as well", () => {
		const quoted = buildTweet({}) as unknown as Tweet["quoted_tweet"];
		const tweet = { ...buildTweet({}), quoted_tweet: quoted } as Tweet;

		const normalized = normalizeTweetEntities(tweet);

		expect(normalized.quoted_tweet?.entities).toEqual({
			hashtags: [],
			urls: [],
			user_mentions: [],
			symbols: [],
		});
	});

	it("leaves a tweet without a quoted tweet unchanged", () => {
		const tweet = buildTweet({ user_mentions: [] });

		const normalized = normalizeTweetEntities(tweet);

		expect(normalized.quoted_tweet).toBeUndefined();
	});
});
