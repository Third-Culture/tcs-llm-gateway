import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import express from "express";
import session from "express-session";

import type { NextFunction, Request, Response } from "express";

declare module "express-session" {
	interface SessionData {
		user?: SessionUser;
	}
}

interface SessionUser {
	email: string;
	name?: string;
	picture?: string;
}

interface GoogleTokenInfo {
	aud?: string;
	email?: string;
	email_verified?: boolean | "true" | "false";
	hd?: string;
	name?: string;
	picture?: string;
	error?: string;
	error_description?: string;
}

type VerifyResult =
	| { ok: true; user: SessionUser }
	| { ok: false; status: number; error: string };

const __dirname = dirname(fileURLToPath(import.meta.url));

const {
	GOOGLE_CLIENT_ID,
	SESSION_SECRET,
	LLM_GATEWAY_URL = "https://llmgateway-gateway-qm3fwjoi5q-uc.a.run.app",
	LLM_API_KEY,
	LLM_INTERNAL_TOKEN,
	LLM_INTERNAL_URL = "https://llmgateway-api-qm3fwjoi5q-uc.a.run.app",
	PORT = "7070",
} = process.env;

for (const key of ["GOOGLE_CLIENT_ID", "SESSION_SECRET", "LLM_API_KEY"]) {
	if (!process.env[key]) {
		console.error(`Missing required env var: ${key}`);
		process.exit(1);
	}
}

const ALLOWED_DOMAIN = "thirdculture.world";
const LLM_HOST = "llm.thirdculture.systems";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

app.use(
	session({
		secret: SESSION_SECRET!,
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: true,
			httpOnly: true,
			maxAge: SESSION_TTL_MS,
		},
	}),
);

function requireAuth(req: Request, res: Response, next: NextFunction): void {
	if (req.session.user) {
		next();
		return;
	}
	res.status(401).json({ error: "Not authenticated" });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const TRANSFER_TOKEN_TTL_MS = 2 * 60 * 1000;

function signTransferToken(user: SessionUser): string {
	const payload = Buffer.from(
		JSON.stringify({ user, exp: Date.now() + TRANSFER_TOKEN_TTL_MS }),
	).toString("base64url");
	const sig = createHmac("sha256", SESSION_SECRET!)
		.update(payload)
		.digest("base64url");
	return `${payload}.${sig}`;
}

function verifyTransferToken(token: unknown): SessionUser | null {
	const [payload, sig] = String(token || "").split(".");
	if (!payload || !sig) {
		return null;
	}

	const expected = createHmac("sha256", SESSION_SECRET!)
		.update(payload)
		.digest("base64url");
	const actualBuffer = Buffer.from(sig);
	const expectedBuffer = Buffer.from(expected);
	if (
		actualBuffer.length !== expectedBuffer.length ||
		!timingSafeEqual(actualBuffer, expectedBuffer)
	) {
		return null;
	}

	const parsed = JSON.parse(
		Buffer.from(payload, "base64url").toString("utf8"),
	) as {
		user?: SessionUser;
		exp?: number;
	};
	if (!parsed.exp || parsed.exp < Date.now() || !parsed.user?.email) {
		return null;
	}
	return parsed.user;
}

async function verifyGoogleCredential(
	credential: unknown,
): Promise<VerifyResult> {
	if (!credential || typeof credential !== "string") {
		return { ok: false, status: 400, error: "No credential provided" };
	}

	const r = await fetch(
		`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
	);
	const info = (await r.json()) as GoogleTokenInfo;

	if (!r.ok || info.error) {
		return {
			ok: false,
			status: 401,
			error: info.error_description || "Invalid token",
		};
	}
	if (info.aud !== GOOGLE_CLIENT_ID) {
		return { ok: false, status: 401, error: "Token audience mismatch" };
	}
	const email = typeof info.email === "string" ? info.email.toLowerCase() : "";
	const isVerified =
		info.email_verified === true || info.email_verified === "true";
	const hasAllowedDomain =
		info.hd === ALLOWED_DOMAIN || email.endsWith(`@${ALLOWED_DOMAIN}`);
	if (!isVerified || !hasAllowedDomain) {
		console.warn("Rejected Google login", {
			email,
			hd: info.hd,
			email_verified: info.email_verified,
		});
		return {
			ok: false,
			status: 403,
			error: `Access restricted to verified @${ALLOWED_DOMAIN} accounts`,
		};
	}

	return { ok: true, user: { email, name: info.name, picture: info.picture } };
}

app.post("/auth/verify", async (req: Request, res: Response): Promise<void> => {
	try {
		const result = await verifyGoogleCredential(req.body.credential);
		if (!result.ok) {
			res.status(result.status).json({ error: result.error });
			return;
		}

		req.session.user = result.user;
		res.json({ ok: true, email: result.user.email, name: result.user.name });
	} catch (err) {
		console.error("Token verification error:", (err as Error).message);
		res.status(500).json({ error: "Token verification failed" });
	}
});

app.get("/auth/complete", (req: Request, res: Response): void => {
	try {
		const user = verifyTransferToken(req.query.token);
		if (!user) {
			res.status(401).send("Invalid or expired login token.");
			return;
		}

		req.session.user = user;
		res.redirect("/");
	} catch (err) {
		console.error("Transfer token error:", (err as Error).message);
		res.status(401).send("Invalid login token.");
	}
});

app.get("/llm-login", (_req: Request, res: Response): void => {
	res.type("html").send(renderLoginBrokerPage());
});

app.post(
	"/llm-login/auth/verify",
	async (req: Request, res: Response): Promise<void> => {
		try {
			const result = await verifyGoogleCredential(req.body.credential);
			if (!result.ok) {
				res.status(result.status).json({ error: result.error });
				return;
			}

			const returnTo =
				typeof req.body.returnTo === "string"
					? req.body.returnTo
					: `https://${LLM_HOST}`;
			const url = new URL(returnTo);
			if (url.hostname !== LLM_HOST) {
				res.status(400).json({ error: "Invalid return URL" });
				return;
			}
			url.pathname = "/auth/complete";
			url.search = new URLSearchParams({
				token: signTransferToken(result.user),
			}).toString();

			res.json({ ok: true, redirectUrl: url.toString() });
		} catch (err) {
			console.error("Broker login error:", (err as Error).message);
			res.status(500).json({ error: "Token verification failed" });
		}
	},
);

app.post("/auth/logout", (req: Request, res: Response): void => {
	req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req: Request, res: Response): void => {
	if (!req.session.user) {
		res.status(401).json({ error: "Not authenticated" });
		return;
	}
	res.json(req.session.user);
});

// ── Stats proxy ───────────────────────────────────────────────────────────────

app.get(
	"/api/stats",
	requireAuth,
	async (_req: Request, res: Response): Promise<void> => {
		if (!LLM_INTERNAL_TOKEN) {
			res.json({
				days: [],
				totals: { requests: 0, errors: 0, cost: 0 },
				note: "LLM_INTERNAL_TOKEN not configured",
			});
			return;
		}
		try {
			const r = await fetch(`${LLM_INTERNAL_URL}/internal/stats`, {
				headers: { Authorization: `Bearer ${LLM_INTERNAL_TOKEN}` },
			});
			const data = await r.json();
			res.json(data);
		} catch (err) {
			console.error("Stats fetch error:", (err as Error).message);
			res.status(502).json({ error: "Failed to fetch stats" });
		}
	},
);

// ── Chat proxy (streaming) ────────────────────────────────────────────────────

app.post(
	"/api/chat",
	requireAuth,
	async (req: Request, res: Response): Promise<void> => {
		const { messages, model = "tcs-balanced" } = req.body;
		if (!Array.isArray(messages) || messages.length === 0) {
			res.status(400).json({ error: "messages array required" });
			return;
		}

		try {
			const upstream = await fetch(`${LLM_GATEWAY_URL}/v1/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${LLM_API_KEY}`,
				},
				body: JSON.stringify({ model, messages, stream: true }),
			});

			if (!upstream.ok) {
				const text = await upstream.text();
				res.status(upstream.status).json({ error: text });
				return;
			}
			if (!upstream.body) {
				res.status(502).json({ error: "Empty upstream response" });
				return;
			}

			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("X-Accel-Buffering", "no");

			const reader = upstream.body.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				res.write(decoder.decode(value, { stream: true }));
			}
			res.end();
		} catch (err) {
			console.error("Chat proxy error:", (err as Error).message);
			if (!res.headersSent) {
				res.status(502).json({ error: "Gateway error" });
			} else {
				res.end();
			}
		}
	},
);

// ── Static ────────────────────────────────────────────────────────────────────

const indexHtml = readFileSync(
	join(__dirname, "..", "public", "index.html"),
	"utf-8",
).replace("__GOOGLE_CLIENT_ID__", GOOGLE_CLIENT_ID!);

function renderIndex(req: Request): string {
	if (req.hostname === LLM_HOST) {
		return indexHtml.replace(
			'<script src="https://accounts.google.com/gsi/client" async defer></script>',
			"",
		);
	}
	return indexHtml;
}

function renderLoginBrokerPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Third Culture — LLM Gateway sign in</title>
  <link rel="icon" type="image/svg+xml" href="/brand/tc-mark-on-light.svg">
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <style>
    :root {
      --bg: #141414;
      --text: #F3F2F0;
      --muted: #CACACA;
      --border: #2a2a2a;
      --brand: #1A58BB;
      --red: #f97066;
      --font: Helvetica, "Helvetica Neue", Arial, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      :root { --bg: #F3F2F0; --text: #141414; --muted: #B3B3B3; --border: #DFDFE8; --brand: #1A58BB; --red: #b42318; }
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; padding: 2rem; text-align: center; }
    main { display: grid; gap: 1.25rem; justify-items: center; max-width: 28rem; }
    .mark { width: 48px; height: 48px; color: var(--text); }
    .wordmark { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }
    h1 { font-weight: 700; font-size: 2rem; letter-spacing: -0.02em; line-height: 1.1; }
    p { color: var(--muted); font-size: 0.95rem; }
    .divider { width: 240px; height: 1px; background: var(--border); }
    #error { color: var(--red); display: none; font-size: 0.82rem; }
  </style>
</head>
<body>
  <main>
    <svg class="mark" viewBox="0 0 243 141" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g>
        <path d="M114.66 110.98C103.54 123.1 87.6 130.48 70.24 130.48C37.02 130.48 10 103.46 10 70.24C10 37.02 37.02 10 70.24 10C87.57 10 103.51 17.32 114.66 29.49C117.02 32.07 119.17 34.86 121.07 37.85C122.97 34.88 125.13 32.09 127.51 29.5C125.55 26.75 123.41 24.15 121.1 21.73C108.15 8.14 89.96 0 70.24 0C31.51 0 0 31.51 0 70.24C0 108.97 31.51 140.48 70.24 140.48C90 140.48 108.18 132.28 121.09 118.74C123.41 116.32 125.55 113.72 127.5 110.97C125.12 108.38 122.97 105.59 121.07 102.63C119.17 105.61 117.03 108.41 114.66 110.98Z" fill="currentColor"/>
        <path d="M97.75 36.47V48.43H77.43V104H63.14V48.43H42.72V36.47H97.75Z" fill="currentColor"/>
        <path d="M171.84 0C151.91 0 133.89 8.34 121.1 21.73C118.78 24.15 116.63 26.75 114.66 29.49C106.45 40.99 101.61 55.06 101.61 70.24C101.61 85.42 106.44 99.48 114.66 110.98C116.62 113.72 118.77 116.32 121.09 118.74C133.89 132.13 151.9 140.48 171.84 140.48C210.57 140.48 242.08 108.97 242.08 70.24C242.08 31.51 210.57 0 171.84 0ZM171.84 130.48C154.31 130.48 138.51 122.96 127.5 110.97C125.12 108.38 122.97 105.59 121.07 102.63C115.08 93.27 111.61 82.15 111.61 70.24C111.61 58.33 115.08 47.21 121.07 37.85C122.97 34.88 125.13 32.09 127.51 29.5C138.52 17.52 154.32 10 171.84 10C205.06 10 232.08 37.02 232.08 70.24C232.08 103.46 205.06 130.48 171.84 130.48Z" fill="currentColor"/>
        <path d="M192.41 99.54C187.34 104.15 180.86 106.46 172.96 106.46C163.19 106.46 155.51 103.35 149.92 97.11C144.33 90.85 141.53 82.27 141.53 71.36C141.53 59.57 144.71 50.48 151.07 44.1C156.6 38.54 163.64 35.76 172.18 35.76C183.61 35.76 191.97 39.49 197.25 46.94C200.17 51.12 201.74 55.32 201.95 59.54H187.76C186.84 56.3 185.66 53.86 184.21 52.21C181.63 49.28 177.8 47.81 172.73 47.81C167.66 47.81 163.5 49.89 160.52 54.04C157.54 58.16 156.05 64.01 156.05 71.59C156.05 79.17 157.62 84.85 160.75 88.63C163.91 92.39 167.92 94.27 172.78 94.27C177.64 94.27 181.55 92.65 184.16 89.41C185.6 87.67 186.8 85.06 187.75 81.58H201.81C200.58 88.94 197.45 94.93 192.41 99.54Z" fill="currentColor"/>
      </g>
    </svg>
    <div class="wordmark">Third Culture</div>
    <h1>LLM Gateway</h1>
    <p>Sign in with your @${ALLOWED_DOMAIN} account.</p>
    <div class="divider"></div>
    <div id="g_id_onload"
      data-client_id="${GOOGLE_CLIENT_ID}"
      data-context="signin"
      data-ux_mode="popup"
      data-callback="handleGoogleSignIn"
      data-auto_prompt="false"></div>
    <div class="g_id_signin"
      data-type="standard"
      data-shape="rectangular"
      data-theme="filled_blue"
      data-text="sign_in_with"
      data-size="large"
      data-logo_alignment="left"></div>
    <div id="error"></div>
  </main>
  <script>
    async function handleGoogleSignIn(response) {
      const params = new URLSearchParams(location.search);
      const returnTo = params.get('return') || 'https://${LLM_HOST}';
      const r = await fetch('/llm-login/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential, returnTo }),
      });
      const data = await r.json();
      if (!r.ok) {
        const el = document.getElementById('error');
        el.textContent = data.error || 'Login failed';
        el.style.display = 'block';
        return;
      }
      location.href = data.redirectUrl;
    }
  </script>
</body>
</html>`;
}

app.get("/", (req: Request, res: Response) =>
	res.type("html").send(renderIndex(req)),
);
app.get("/index.html", (req: Request, res: Response) =>
	res.type("html").send(renderIndex(req)),
);
app.use(express.static(join(__dirname, "..", "public")));

app.listen(Number(PORT), () => {
	console.log(`LLM admin running on :${PORT}`);
});
