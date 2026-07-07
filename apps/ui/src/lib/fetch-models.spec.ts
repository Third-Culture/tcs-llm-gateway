import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config-server", () => ({
	getConfig: vi.fn().mockReturnValue({
		apiBackendUrl: "http://localhost:4002",
	}),
}));

describe("fetchModels", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns empty array when fetch throws without using console.error", async () => {
		const errorSpy = vi.spyOn(console, "error");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);

		const { fetchModels } = await import("./fetch-models");
		const result = await fetchModels();

		expect(result).toEqual([]);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("returns empty array on non-OK response without using console.error", async () => {
		const errorSpy = vi.spyOn(console, "error");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				statusText: "Internal Server Error",
			}),
		);

		const { fetchModels } = await import("./fetch-models");
		const result = await fetchModels();

		expect(result).toEqual([]);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
	});
});

describe("fetchProviders", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns empty array when fetch throws without using console.error", async () => {
		const errorSpy = vi.spyOn(console, "error");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);

		const { fetchProviders } = await import("./fetch-models");
		const result = await fetchProviders();

		expect(result).toEqual([]);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
	});

	it("returns empty array on non-OK response without using console.error", async () => {
		const errorSpy = vi.spyOn(console, "error");
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				statusText: "Service Unavailable",
			}),
		);

		const { fetchProviders } = await import("./fetch-models");
		const result = await fetchProviders();

		expect(result).toEqual([]);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalled();
	});
});
