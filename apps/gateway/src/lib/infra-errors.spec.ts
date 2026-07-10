import { describe, expect, it } from "vitest";

import { isInfrastructureError } from "./infra-errors.js";

describe("isInfrastructureError", () => {
	it("detects ECONNREFUSED errors", () => {
		const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");
		(error as NodeJS.ErrnoException).code = "ECONNREFUSED";
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ECONNRESET errors", () => {
		const error = new Error("read ECONNRESET");
		(error as NodeJS.ErrnoException).code = "ECONNRESET";
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ETIMEDOUT errors", () => {
		const error = new Error("connect ETIMEDOUT 10.0.0.1:6379");
		(error as NodeJS.ErrnoException).code = "ETIMEDOUT";
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects ENOTFOUND (DNS) errors", () => {
		const error = new Error("getaddrinfo ENOTFOUND db.example.com");
		(error as NodeJS.ErrnoException).code = "ENOTFOUND";
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Postgres connection terminated messages", () => {
		const error = new Error("Connection terminated unexpectedly");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects pool exhaustion messages", () => {
		const error = new Error("cannot acquire a connection from the pool");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects Redis connection errors by message", () => {
		const error = new Error("Redis connection lost");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects socket hang up", () => {
		const error = new Error("socket hang up");
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("detects infra errors in cause chain", () => {
		const cause = new Error("connect ECONNREFUSED 10.0.0.1:5432");
		(cause as NodeJS.ErrnoException).code = "ECONNREFUSED";
		const error = new Error("query failed", { cause });
		expect(isInfrastructureError(error)).toBe(true);
	});

	it("returns false for application errors", () => {
		const error = new Error("Cannot read properties of undefined");
		expect(isInfrastructureError(error)).toBe(false);
	});

	it("returns false for generic errors", () => {
		const error = new Error("Something went wrong");
		expect(isInfrastructureError(error)).toBe(false);
	});

	it("returns false for TypeError", () => {
		const error = new TypeError("x is not a function");
		expect(isInfrastructureError(error)).toBe(false);
	});
});
