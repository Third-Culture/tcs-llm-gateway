import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://llmgateway.io"),
	title: {
		default: "Third Culture — LLM Gateway",
		template: "%s | Third Culture",
	},
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface. Access OpenAI, Anthropic, Google, and 19+ providers through one API.",
	authors: [{ name: "Third Culture." }],
	creator: "Third Culture.",
	publisher: "Third Culture.",
	icons: {
		icon: [{ url: "/brand/tc-mark-on-light.svg?v=1", type: "image/svg+xml" }],
		apple: [{ url: "/brand/tc-mark-on-light.svg?v=1" }],
	},
	manifest: "/favicon/site.webmanifest?v=2",
	alternates: {
		canonical: "./",
	},
	openGraph: {
		title: "Third Culture — LLM Gateway",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface. Access OpenAI, Anthropic, Google, and 19+ providers through one API.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://llmgateway.io",
		siteName: "Third Culture",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "Third Culture — LLM Gateway",
		description:
			"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
		images: ["/opengraph.png?v=1"],
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
};

const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "Third Culture.",
	url: "https://llmgateway.io",
	logo: {
		"@type": "ImageObject",
		url: "https://llmgateway.io/brand/tc-mark-on-light.svg",
	},
	description:
		"Route, manage, and analyze your LLM requests across multiple providers with a unified API interface.",
	contactPoint: {
		"@type": "ContactPoint",
		email: "contact@llmgateway.io",
		contactType: "customer support",
	},
};

const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "Third Culture — LLM Gateway",
	url: "https://llmgateway.io",
	potentialAction: {
		"@type": "SearchAction",
		target: {
			"@type": "EntryPoint",
			urlTemplate: "https://llmgateway.io/models?search={search_term_string}",
		},
		"query-input": "required name=search_term_string",
	},
};

export default function RootLayout({ children }: { children: ReactNode }) {
	const config = getConfig();

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<link rel="preconnect" href="https://internal.llmgateway.io" />
				<link rel="preconnect" href="https://docs.llmgateway.io" />
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(organizationSchema),
					}}
				/>
				<script
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(websiteSchema),
					}}
				/>
			</head>
			<body className="min-h-screen font-sans antialiased">
				<Providers config={config}>{children}</Providers>
			</body>
		</html>
	);
}
