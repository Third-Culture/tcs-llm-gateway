"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/lib/config";

import { Logo, ThemeToggle } from "@llmgateway/shared/components";

export function Header() {
	const config = useAppConfig();
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<header className="border-b border-border/50">
			<div className="container mx-auto px-4 py-4 flex items-center justify-between">
				<Link href="/" className="flex items-center gap-3">
					<Logo className="h-6 w-auto text-foreground" />
					<div className="flex flex-col">
						<span className="text-lg font-bold leading-none">DevPass</span>
						<span className="hidden text-xs text-muted-foreground sm:inline">
							by Third Culture.
						</span>
					</div>
				</Link>

				{/* Desktop nav */}
				<div className="hidden sm:flex items-center gap-3">
					<ThemeToggle variant="pill" />
					<Button variant="ghost" size="sm" asChild>
						<a
							href={`${config.uiUrl}/models`}
							target="_blank"
							rel="noopener noreferrer"
						>
							Models
						</a>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<a href={config.docsUrl} target="_blank" rel="noopener noreferrer">
							Docs
						</a>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<a href={config.uiUrl} target="_blank" rel="noopener noreferrer">
							Dashboard
						</a>
					</Button>
					<Button variant="ghost" size="sm" asChild>
						<Link href="/login">Sign in</Link>
					</Button>
					<Button size="sm" asChild>
						<Link href="/signup">Get Started</Link>
					</Button>
				</div>

				{/* Mobile menu button */}
				<button
					type="button"
					onClick={() => setMenuOpen(!menuOpen)}
					className="sm:hidden p-2 -mr-2"
					aria-label={menuOpen ? "Close menu" : "Open menu"}
				>
					{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
				</button>
			</div>

			{/* Mobile nav */}
			{menuOpen && (
				<div className="sm:hidden border-t border-border/50 px-4 py-4 space-y-3">
					<Link
						href="/coding-models"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Models
					</Link>
					<a
						href={config.docsUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Docs
					</a>
					<a
						href={config.uiUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
					>
						Dashboard
					</a>
					<Link
						href="/login"
						className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setMenuOpen(false)}
					>
						Sign in
					</Link>
					<Button size="sm" className="w-full" asChild>
						<Link href="/signup" onClick={() => setMenuOpen(false)}>
							Get Started
						</Link>
					</Button>
				</div>
			)}
		</header>
	);
}
