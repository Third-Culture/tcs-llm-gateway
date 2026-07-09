import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

/**
 * Regression test: Ensures that `logger.error` is only used in approved
 * locations. Cloud Run's log-based alerting fires on severity>=ERROR, so
 * operational/expected failures (upstream timeouts, client disconnects,
 * Redis transient errors, SSE write failures) MUST use logger.warn instead.
 *
 * logger.error should ONLY appear in:
 * - app.ts global onError handler (HTTP 500 and unhandled exceptions)
 * - serve.ts fatal startup/shutdown paths
 * - scripts/ (build-time tools, not production runtime)
 */

const ALLOWED_ERROR_FILES = new Set([
	"src/app.ts",
	"src/serve.ts",
	"src/scripts/generate-openapi.ts",
]);

function collectTsFiles(dir: string, base: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const relativePath = join(base, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			if (entry === "node_modules" || entry === "dist") {
				continue;
			}
			results.push(...collectTsFiles(fullPath, relativePath));
		} else if (
			entry.endsWith(".ts") &&
			!entry.endsWith(".spec.ts") &&
			!entry.endsWith(".e2e.ts") &&
			!entry.endsWith(".d.ts")
		) {
			results.push(relativePath);
		}
	}
	return results;
}

describe("log severity policy", () => {
	it("logger.error is only used in approved global handlers", () => {
		const gatewayRoot = join(__dirname, "..");
		const srcDir = join(gatewayRoot, "src");
		const files = collectTsFiles(srcDir, "src");

		const violations: Array<{ file: string; line: number; text: string }> = [];

		for (const file of files) {
			if (ALLOWED_ERROR_FILES.has(file)) {
				continue;
			}

			const content = readFileSync(join(gatewayRoot, file), "utf-8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("logger.error")) {
					violations.push({
						file,
						line: i + 1,
						text: lines[i].trim(),
					});
				}
			}
		}

		if (violations.length > 0) {
			const message = violations
				.map((v) => `  ${v.file}:${v.line} → ${v.text}`)
				.join("\n");
			expect.fail(
				`Found ${violations.length} logger.error call(s) outside approved files.\n` +
					`These should use logger.warn to avoid false-positive Cloud Run alerts:\n${message}`,
			);
		}
	});
});
