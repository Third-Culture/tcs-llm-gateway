import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import "./globals.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	metadataBase: new URL("https://chat.llmgateway.io"),
	title: {
		default:
			"Third Culture Playground — Chat, Image & Video with 210+ AI Models",
		template: "%s | Third Culture Playground",
	},
	description:
		"Test and compare 210+ AI models in one playground. Chat with GPT-4, Claude, Gemini, generate images and videos, and run multi-model group chats.",
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
		title: "Third Culture Playground — Chat, Image & Video Generation",
		description:
			"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
		images: ["/opengraph.png?v=1"],
		type: "website",
		url: "https://chat.llmgateway.io",
		siteName: "Third Culture Playground",
		locale: "en_US",
	},
	twitter: {
		card: "summary_large_image",
		title: "Third Culture Playground — Chat, Image & Video Generation",
		description:
			"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
		images: ["/opengraph.png?v=1"],
	},
};

const webSiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "Third Culture Playground",
	url: "https://chat.llmgateway.io",
	description:
		"Test and compare 210+ AI models in one playground. Chat, generate images and videos, and run multi-model group chats.",
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
