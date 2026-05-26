import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { getSessionUser } from "@/lib/get-session-user";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Admin",
	robots: {
		index: false,
		follow: false,
	},
};

interface AdminLayoutProps {
	children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
	const user = await getSessionUser();

	if (!user) {
		redirect("/login");
	}

	if (!user.isAdmin) {
		redirect("/dashboard");
	}

	return <AdminShell user={user}>{children}</AdminShell>;
}
