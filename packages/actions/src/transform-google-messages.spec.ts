import { describe, expect, it } from "vitest";

import { transformGoogleMessages } from "./transform-google-messages.js";

describe("transformGoogleMessages", () => {
	it("merges adjacent user-role messages", async () => {
		const result = await transformGoogleMessages([
			{
				role: "system",
				content: "Always answer briefly.",
			},
			{
				role: "user",
				content: "Say OK.",
			},
		]);

		expect(result).toEqual([
			{
				role: "user",
				parts: [{ text: "Always answer briefly." }, { text: "Say OK." }],
			},
		]);
	});

	it("merges adjacent model-role messages", async () => {
		const result = await transformGoogleMessages([
			{
				role: "assistant",
				content: "First.",
			},
			{
				role: "assistant",
				content: "Second.",
			},
		]);

		expect(result).toEqual([
			{
				role: "model",
				parts: [{ text: "First." }, { text: "Second." }],
			},
		]);
	});
});
