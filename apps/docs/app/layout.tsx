// eslint-disable-next-line import/order
import "./global.css";

import { RootProvider } from "fumadocs-ui/provider/next";

import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: "Third Culture — LLM Gateway Documentation",
	description:
		"Third Culture LLM Gateway documentation — route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	icons: {
		icon: [{ url: "/brand/tc-mark-on-light.svg?v=1", type: "image/svg+xml" }],
	},
	alternates: {
		canonical: "./",
	},
};

export default function Layout({ children }: { children: ReactNode }) {
	const posthogKey = process.env.POSTHOG_KEY ?? "";
	const posthogHost = process.env.POSTHOG_HOST ?? "";

	return (
		<html lang="en" className="font-sans" suppressHydrationWarning>
			<body className="flex min-h-screen flex-col">
				<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
					<PostHogProvider>
						<RootProvider
							theme={{
								defaultTheme: "system",
							}}
						>
							{children}
						</RootProvider>
					</PostHogProvider>
				</ConfigProvider>
			</body>
		</html>
	);
}
