import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/config-server", () => ({
	getConfig: vi.fn().mockReturnValue({
		apiBackendUrl: "http://localhost:4002",
	}),
}));

describe("POST /api/chat-support", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns a 502 instead of throwing when the upstream fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("fetch failed")),
		);

		const { POST } = await import("./route");
		const req = new Request("http://localhost:3002/api/chat-support", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const response = await POST(req);

		expect(response.status).toBe(502);
		const body = await response.json();
		expect(body).toEqual({
			error: "Chat support service is temporarily unavailable",
		});
	});

	it("forwards a successful upstream response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("ok", {
					status: 200,
					headers: { "content-type": "text/plain" },
				}),
			),
		);

		const { POST } = await import("./route");
		const req = new Request("http://localhost:3002/api/chat-support", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ messages: [] }),
		});

		const response = await POST(req);

		expect(response.status).toBe(200);
	});
});
