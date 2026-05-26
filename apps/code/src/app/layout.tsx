import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://code.llmgateway.io"),
	title: {
		default: "DevPass by Third Culture — All-Access Dev Plans for AI Coding",
		template: "%s | DevPass by Third Culture",
	},
	description:
		"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool. 200+ models, one API key.",
	icons: {
		icon: [{ url: "/brand/tc-mark-on-light.svg?v=1", type: "image/svg+xml" }],
	},
	alternates: {
		canonical: "./",
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	openGraph: {
		title: "DevPass by Third Culture — All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, Cline, and any OpenAI-compatible tool.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://code.llmgateway.io",
		siteName: "DevPass by Third Culture",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "DevPass by Third Culture — All-Access Dev Plans for AI Coding",
		description:
			"One subscription, every coding model. Fixed-price dev plans for Claude Code, Cursor, and 200+ models.",
		images: ["/opengraph.png?v=1"],
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "DevPass by Third Culture",
	url: "https://code.llmgateway.io",
	description:
		"Fixed-price dev plans for AI-powered coding with Claude Code, Cursor, Cline, and any OpenAI-compatible tool. One subscription, every model.",
	publisher: {
		"@type": "Organization",
		name: "Third Culture.",
		url: "https://llmgateway.io",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(webSiteSchema),
					}}
				/>
			</head>
			<body className="font-sans antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
