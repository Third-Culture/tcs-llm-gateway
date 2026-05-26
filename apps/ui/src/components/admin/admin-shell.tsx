"use client";

import { ArrowLeft, LineChart } from "lucide-react";
import Link from "next/link";

import type { SessionUser } from "@/lib/get-session-user";
import type { ReactNode } from "react";

interface AdminShellProps {
	user: SessionUser;
	children: ReactNode;
}

export function AdminShell({ user, children }: AdminShellProps) {
	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-20 border-b border-border bg-background">
				<div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
					<div className="flex items-center gap-4">
						<Link
							href="/dashboard"
							className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeft className="size-4" />
							Dashboard
						</Link>
						<div className="hidden h-4 w-px bg-border sm:block" />
						<div className="flex items-center gap-2">
							<div className="flex size-8 items-center justify-center rounded-[var(--tcs-radius-sm)] border border-border bg-muted text-primary">
								<LineChart className="size-4" />
							</div>
							<div>
								<p className="text-sm font-semibold leading-none">Admin</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									Platform operations
								</p>
							</div>
						</div>
					</div>
					<p className="hidden text-xs text-muted-foreground sm:block">
						{user.email}
					</p>
				</div>
			</header>
			<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
				{children}
			</main>
		</div>
	);
}
