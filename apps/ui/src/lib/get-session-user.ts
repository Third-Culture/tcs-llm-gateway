import { cookies } from "next/headers";

import { getConfig } from "@/lib/config-server";

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	isAdmin: boolean;
	onboardingCompleted: boolean;
	emailVerified: boolean;
}

export async function getSessionUser(): Promise<SessionUser | null> {
	const config = getConfig();
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	const response = await fetch(`${config.apiBackendUrl}/user/me`, {
		method: "GET",
		headers: {
			Cookie: secureSessionCookie
				? `__Secure-${key}=${secureSessionCookie.value}`
				: sessionCookie
					? `${key}=${sessionCookie.value}`
					: "",
		},
		cache: "no-store",
	});

	if (!response.ok) {
		return null;
	}

	const data = (await response.json()) as { user: SessionUser };
	return data.user;
}
