"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./dropdown-menu";

interface ThemeToggleProps {
	className?: string;
	variant?: "dropdown" | "pill";
}

export function ThemeToggle({
	className,
	variant = "dropdown",
}: ThemeToggleProps) {
	const { theme, setTheme, resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	if (!mounted) {
		return variant === "pill" ? (
			<div
				className={cn(
					"h-8 w-[4.5rem] rounded-[var(--tcs-radius-sm)] border border-border bg-muted",
					className,
				)}
			/>
		) : (
			<Button
				variant="ghost"
				size="icon"
				className={cn("size-9", className)}
				aria-hidden
			/>
		);
	}

	if (variant === "pill") {
		const activeTheme = theme ?? "system";
		const options = [
			{ value: "light", icon: Sun, label: "Light" },
			{ value: "dark", icon: Moon, label: "Dark" },
			{ value: "system", icon: Monitor, label: "System" },
		] as const;

		return (
			<div
				className={cn(
					"inline-flex items-center gap-0.5 rounded-[var(--tcs-radius-sm)] border border-border bg-card p-0.5",
					className,
				)}
				role="group"
				aria-label="Theme"
			>
				{options.map(({ value, icon: Icon, label }) => (
					<button
						key={value}
						type="button"
						onClick={() => setTheme(value)}
						className={cn(
							"inline-flex size-7 items-center justify-center rounded-[var(--tcs-radius-sm)] transition-colors",
							activeTheme === value
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						aria-label={label}
						aria-pressed={activeTheme === value}
					>
						<Icon className="size-3.5" strokeWidth={1.75} />
					</button>
				))}
			</div>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className={cn("size-9", className)}>
					<Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
					<Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
					<span className="sr-only">Toggle theme</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => setTheme("light")}>
					<Sun className="mr-2 size-4" />
					Light
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("dark")}>
					<Moon className="mr-2 size-4" />
					Dark
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme("system")}>
					<Monitor className="mr-2 size-4" />
					System
				</DropdownMenuItem>
				{resolvedTheme ? (
					<div className="px-2 py-1.5 text-xs text-muted-foreground">
						Active: {resolvedTheme}
					</div>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
