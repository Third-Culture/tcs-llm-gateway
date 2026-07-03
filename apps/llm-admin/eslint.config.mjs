import lint from "../../eslint.config.mjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
	...lint,
	{
		rules: {
			// Standalone Express service with no @llmgateway/logger dependency
			// (deliberately kept dependency-free for a single-folder Docker
			// build — see README.md).
			"no-console": "off",
		},
	},
];
