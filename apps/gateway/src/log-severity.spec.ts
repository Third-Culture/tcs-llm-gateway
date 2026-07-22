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

	// Inverse guard. The two checks above stop *operational* noise from being
	// logged at ERROR. This check stops the opposite failure mode: silencing a
	// *genuine* outage by downgrading/removing the global failure handlers to
	// quiet the `log_error` alert.
	//
	// The recurring 2026-07 `llmgateway-gateway` alert was ultimately confirmed
	// (owner, against real Cloud Logging entries — PR #19) to be Cloud Run
	// *platform request logs* for HTTP 500 when an upstream provider (Google AI
	// Studio) returned 503 on a no-fallback pinned route — an external
	// dependency, fixed in monitoring (tcs-monitoring #36 / TCS-1154), NOT a
	// gateway code bug. Across 7+ prior autofix PRs the tempting "fix" was to
	// downgrade or swallow these handlers so the alert stops paging; that hides
	// real outages. This test fails if any genuine failure handler is downgraded
	// away from ERROR/CRITICAL.
	it("genuine failure handlers still escalate to ERROR/CRITICAL", () => {
		const gatewayRoot = join(__dirname, "..");

		const requiredEscalations: Array<{ file: string; markers: string[] }> = [
			{
				file: "src/app.ts",
				// Global onError handler: real HTTP 500s and unhandled exceptions.
				markers: [
					'logger.error("HTTP 500 exception"',
					'logger.error(\n\t\t"Unhandled error"',
				],
			},
			{
				file: "src/serve.ts",
				// Fatal startup/shutdown + process-level crash handlers.
				markers: [
					'logger.error("Failed to start server"',
					'logger.error(\n\t\t\t"Error during graceful shutdown"',
					"logger.fatal(",
				],
			},
		];

		const missing: string[] = [];
		for (const { file, markers } of requiredEscalations) {
			const content = readFileSync(join(gatewayRoot, file), "utf-8");
			for (const marker of markers) {
				if (!content.includes(marker)) {
					missing.push(`  ${file} → expected \`${marker}\``);
				}
			}
		}

		if (missing.length > 0) {
			expect.fail(
				`A genuine failure handler was downgraded away from ERROR/CRITICAL.\n` +
					`Real 500s / unhandled exceptions / fatal startup + shutdown + crash\n` +
					`paths MUST keep paging — do not silence them to quiet the log_error\n` +
					`alert. Missing escalations:\n${missing.join("\n")}`,
			);
		}
	});

	// Forward guard for the 2026-07-21 hot-path deploy (#11), which added a
	// per-request telemetry emit (`tcs_metric` /
	// `llmgateway_daily_tokens_processed`) to `insertLog` in `src/lib/logs.ts`.
	// That runs on every logged completion, so if it were ever emitted at
	// warn/error severity it would page the raw `severity>=ERROR` log_error
	// alert on ordinary traffic. It is intentionally an INFO log — this test
	// fails if a future edit escalates it (the file-scan check above already
	// forbids `logger.error` here; this also forbids `logger.warn`/`fatal` for
	// the metric specifically) so the newest telemetry stays alert-safe.
	it("the TCS daily-tokens metric is emitted at INFO, never warn/error", () => {
		const logsPath = join(__dirname, "lib", "logs.ts");
		const content = readFileSync(logsPath, "utf-8");
		const lines = content.split("\n");

		const metricLogLines = lines
			.map((text, i) => ({ text: text.trim(), line: i + 1 }))
			.filter(({ text }) => /logger\.\w+\(/.test(text) && text.includes("tcs"));

		expect(
			metricLogLines.length,
			"expected the TCS metric emit to still exist in src/lib/logs.ts",
		).toBeGreaterThan(0);

		const escalated = metricLogLines.filter(({ text }) =>
			/logger\.(warn|error|fatal)\(/.test(text),
		);
		if (escalated.length > 0) {
			const message = escalated
				.map((v) => `  src/lib/logs.ts:${v.line} → ${v.text}`)
				.join("\n");
			expect.fail(
				`The per-request TCS token metric must stay at logger.info.\n` +
					`Emitting it at warn/error would trip the severity>=ERROR log_error\n` +
					`alert on normal traffic:\n${message}`,
			);
		}
	});
});
