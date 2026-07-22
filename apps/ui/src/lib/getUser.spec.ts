import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
	cookies: vi.fn().mockResolvedValue({
		get: vi.fn().mockReturnValue(undefined),
	}),
}));

vi.mock("@/app/posthog", () => ({
	default: vi.fn().mockReturnValue(null),
}));

vi.mock("./config-server", () => ({
	getConfig: vi.fn().mockReturnValue({
		apiBackendUrl: "http://localhost:4002",
	}),
}));

describe("getUser", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns null instead of throwing when fetch throws a network error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);

		const { getUser } = await import("./getUser");
		await expect(getUser()).resolves.toBeNull();
	});

	it("returns null when the API returns a non-OK status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
			}),
		);

		const { getUser } = await import("./getUser");
		const result = await getUser();
		expect(result).toBeNull();
	});

	it("returns null instead of throwing when the API returns a non-JSON body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
			}),
		);

		const { getUser } = await import("./getUser");
		await expect(getUser()).resolves.toBeNull();
	});

	it("returns user data on successful response", async () => {
		const mockUser = { id: "u1", email: "a@b.com", name: "Test" };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockUser),
			}),
		);

		const { getUser } = await import("./getUser");
		const result = await getUser();
		expect(result).toEqual(mockUser);
	});
});
