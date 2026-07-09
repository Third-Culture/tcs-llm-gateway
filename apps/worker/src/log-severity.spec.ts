import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { describe, expect, it } from "vitest";

/**
 * Regression test: Ensures that `logger.error` is only used in approved
 * locations. Cloud Run's log-based alerting fires on severity>=ERROR, so
 * operational/expected failures (DB transient errors, Stripe failures,
 * upstream timeouts, Redis connectivity issues) MUST use logger.warn instead.
 *
 * logger.error should ONLY appear in:
 * - index.ts global handlers (uncaught exceptions, unhandled rejections,
 *   graceful shutdown failures, fatal startup errors)
 * - worker.ts data-loss paths (failed to re-queue after all retries)
 * - worker.ts shutdown timeout (worker in broken state)
 * - worker.ts connection close errors during final shutdown
 */

const ALLOWED_ERROR_FILES = new Set(["src/index.ts", "src/worker.ts"]);

function collectTsFiles(dir: string, base: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) {
		return results;
	}
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

describe("worker log severity policy", () => {
	it("logger.error is only used in approved critical paths", () => {
		const workerRoot = join(__dirname, "..");
		const srcDir = join(workerRoot, "src");
		const files = collectTsFiles(srcDir, "src");

		const violations: Array<{ file: string; line: number; text: string }> = [];
		for (const file of files) {
			if (ALLOWED_ERROR_FILES.has(file)) {
				continue;
			}
			const content = readFileSync(join(workerRoot, file), "utf-8");
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

	it("approved files only use logger.error for critical paths", () => {
		const workerRoot = join(__dirname, "..");

		const indexContent = readFileSync(
			join(workerRoot, "src/index.ts"),
			"utf-8",
		);
		const indexErrorCount = (indexContent.match(/logger\.error/g) || []).length;
		expect(indexErrorCount).toBeLessThanOrEqual(4);

		const workerContent = readFileSync(
			join(workerRoot, "src/worker.ts"),
			"utf-8",
		);
		const workerErrorCount = (workerContent.match(/logger\.error/g) || [])
			.length;
		expect(workerErrorCount).toBeLessThanOrEqual(3);
	});
});
