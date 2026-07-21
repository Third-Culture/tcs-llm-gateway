import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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
 *
 * This test also scans shared packages imported at runtime by the gateway
 * (cache, db, actions, instrumentation, shared) to prevent regressions
 * where logger.error in dependencies triggers the same alert.
 */

const ALLOWED_ERROR_FILES = new Set([
	"src/app.ts",
	"src/serve.ts",
	"src/scripts/generate-openapi.ts",
]);

const ALLOWED_PACKAGE_ERROR_FILES = new Set([
	"src/index.ts", // logger package itself defines the error() method
	"src/logger.ts", // logger re-exports
	"src/logger.spec.ts",
	"src/migrate.ts", // build-time migration script, not production runtime
]);

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

function scanForViolations(
	rootDir: string,
	files: string[],
	allowedFiles: Set<string>,
	prefix: string,
): Array<{ file: string; line: number; text: string }> {
	const violations: Array<{ file: string; line: number; text: string }> = [];
	for (const file of files) {
		if (allowedFiles.has(file)) {
			continue;
		}
		const content = readFileSync(join(rootDir, file), "utf-8");
		const lines = content.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes("logger.error")) {
				violations.push({
					file: `${prefix}${file}`,
					line: i + 1,
					text: lines[i].trim(),
				});
			}
		}
	}
	return violations;
}

describe("log severity policy", () => {
	it("logger.error is only used in approved global handlers", () => {
		const gatewayRoot = join(__dirname, "..");
		const srcDir = join(gatewayRoot, "src");
		const files = collectTsFiles(srcDir, "src");

		const violations = scanForViolations(
			gatewayRoot,
			files,
			ALLOWED_ERROR_FILES,
			"",
		);

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

	it("shared packages do not use logger.error for operational conditions", () => {
		const packagesRoot = join(__dirname, "..", "..", "..", "packages");
		const runtimePackages = [
			"cache",
			"db",
			"actions",
			"instrumentation",
			"shared",
		];

		const violations: Array<{
			file: string;
			line: number;
			text: string;
		}> = [];

		for (const pkg of runtimePackages) {
			const pkgSrcDir = join(packagesRoot, pkg, "src");
			if (!existsSync(pkgSrcDir)) {
				continue;
			}
			const files = collectTsFiles(pkgSrcDir, "src");
			violations.push(
				...scanForViolations(
					join(packagesRoot, pkg),
					files,
					ALLOWED_PACKAGE_ERROR_FILES,
					`packages/${pkg}/`,
				),
			);
		}

		if (violations.length > 0) {
			const message = violations
				.map((v) => `  ${v.file}:${v.line} → ${v.text}`)
				.join("\n");
			expect.fail(
				`Found ${violations.length} logger.error call(s) in shared packages.\n` +
					`These run inside the gateway process and trigger Cloud Run severity>=ERROR alerts.\n` +
					`Use logger.warn instead:\n${message}`,
			);
		}
	});

	// The flip side of the two tests above: genuine failure handlers MUST keep
	// paging. The recurring `log_error` incident was chased with 7+ cosmetic PRs
	// that downgraded operational logs; the real trigger turned out to be an
	// external upstream 503 surfaced as an HTTP 500 request log (confirmed in
	// Cloud Logging on PR #19, fixed in tcs-monitoring #36 / TCS-1154). To stop a
	// future autofix pass from "fixing" the alert by muting the real handlers,
	// assert that the legitimate ERROR/CRITICAL emitters stay at ERROR/CRITICAL.
	// Downgrading any of these would hide a real outage, not fix one.
	it("genuine failure handlers keep ERROR/CRITICAL severity (no silent muting)", () => {
		const gatewayRoot = join(__dirname, "..");
		const requiredMarkers: Array<{ file: string; markers: string[] }> = [
			{
				file: "src/app.ts",
				markers: [
					'logger.error("HTTP 500 exception"',
					"logger.error(", // "Unhandled error" for non-HTTPException 500s
				],
			},
			{
				file: "src/serve.ts",
				markers: [
					"logger.error(", // "Error during graceful shutdown"
					'logger.fatal("Uncaught exception',
					'logger.fatal("Unhandled rejection',
					'logger.error("Failed to start server"',
				],
			},
		];

		const missing: string[] = [];
		for (const { file, markers } of requiredMarkers) {
			const content = readFileSync(join(gatewayRoot, file), "utf-8");
			for (const marker of markers) {
				if (!content.includes(marker)) {
					missing.push(`  ${file} is missing required handler: ${marker}`);
				}
			}
		}

		if (missing.length > 0) {
			expect.fail(
				`A genuine failure handler was downgraded/removed. Real outages must ` +
					`keep emitting severity>=ERROR — do not silence them to quiet the ` +
					`Cloud Run alert.\n${missing.join("\n")}`,
			);
		}
	});
});
