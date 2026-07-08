import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	robots: {
		index: false,
		follow: false,
	},
};

interface DashboardLayoutProps {
	children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
	// Auth is enforced client-side via useUser(). Server-side getUser() cannot
	// read the session cookie in our Cloud Run deployment because Better Auth
	// sets it on the API origin (llmgateway-api.*.run.app), not the UI origin.
	return children;
}
