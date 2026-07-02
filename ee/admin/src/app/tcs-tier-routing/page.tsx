import { TcsTierRoutingClient } from "@/components/tcs-tier-routing-client";
import { requireSession } from "@/lib/require-session";

export default async function TcsTierRoutingPage() {
	await requireSession();
	return <TcsTierRoutingClient />;
}
