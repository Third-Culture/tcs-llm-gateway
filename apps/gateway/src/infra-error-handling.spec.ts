import { describe, expect, it } from "vitest";

import { isInfrastructureError } from "./lib/infra-errors.js";

describe("isInfrastructureError", () => {
	it("detects ECONNREFUSED errors by message", () => {
		const error = new Error("ECONNREFUSED: postgres unavailable");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ECONNREFUSED errors by code", () => {
		const error = Object.assign(new Error("connect failed"), {
			code: "ECONNREFUSED",
		});
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ETIMEDOUT errors by message", () => {
		const error = new Error("connect ETIMEDOUT 10.0.0.1:5432");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ETIMEDOUT errors by code", () => {
		const error = Object.assign(new Error("request timed out"), {
			code: "ETIMEDOUT",
		});
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ECONNRESET errors", () => {
		const error = Object.assign(new Error("socket hang up"), {
			code: "ECONNRESET",
		});
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects DNS resolution failures (ENOTFOUND)", () => {
		const error = Object.assign(
			new Error("getaddrinfo ENOTFOUND db.example.com"),
			{ code: "ENOTFOUND" },
		);
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Postgres connection terminated messages", () => {
		const error = new Error("Connection terminated unexpectedly");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Postgres too many clients", () => {
		const error = new Error(
			"sorry, too many clients already (max_connections=100)",
		);
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Redis connection errors", () => {
		const error = new Error("Redis connection to 127.0.0.1:6379 failed");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Redis maxRetriesPerRequest errors", () => {
		const error = new Error(
			"Reached the maxRetriesPerRequest limit (which is 3)",
		);
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("does NOT match generic application errors", () => {
		const error = new Error("Cannot read properties of undefined");
		expect(isInfrastructureError(error)).toBe(false);
	});

	it("does NOT match non-Error values", () => {
		expect(isInfrastructureError("string error")).toBe(false);
		expect(isInfrastructureError(null)).toBe(false);
		expect(isInfrastructureError(undefined)).toBe(false);
		expect(isInfrastructureError(42)).toBe(false);
	});

	it("does NOT match HTTP-related errors", () => {
		const error = new Error("Request failed with status 404");
		expect(isInfrastructureError(error)).toBe(false);
	});

	it("does NOT match generic TypeError", () => {
		const error = new TypeError("foo is not a function");
		expect(isInfrastructureError(error)).toBe(false);
	});
});
