"use client";

import { formatDistanceToNow, parseISO } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: "ok" | "error" | "unknown" }) {
	if (status === "ok") {
		return (
			<Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
				<CheckCircle2 className="h-3.5 w-3.5" />
				Healthy
			</Badge>
		);
	}

	if (status === "error") {
		return (
			<Badge variant="destructive" className="gap-1">
				<AlertTriangle className="h-3.5 w-3.5" />
				Failed
			</Badge>
		);
	}

	return (
		<Badge variant="secondary" className="gap-1">
			<Clock className="h-3.5 w-3.5" />
			Not checked yet
		</Badge>
	);
}

function formatRelativeTime(value: string | null | undefined): string {
	if (!value) {
		return "Never";
	}

	return formatDistanceToNow(parseISO(value), { addSuffix: true });
}

function formatProviderChain(
	primaryProvider: string,
	primaryModel: string,
	fallbackProviders: Array<{ providerId: string; modelName: string }>,
): string {
	const chain = [
		`${primaryProvider} (${primaryModel})`,
		...fallbackProviders.map(
			(provider) => `${provider.providerId} (${provider.modelName})`,
		),
	];
	return chain.join(" → ");
}

export function TcsTierRoutingClient() {
	const $api = useApi();
	const { data, isLoading, isFetching, refetch, error } = $api.useQuery(
		"get",
		"/admin/tcs-tier-routing-status",
		{},
		{
			refetchInterval: 60_000,
		},
	);

	const summary = useMemo(() => {
		const tiers = data?.tiers ?? [];
		return {
			total: tiers.length,
			healthy: tiers.filter((tier) => tier.status === "ok").length,
			failed: tiers.filter((tier) => tier.status === "error").length,
			unknown: tiers.filter((tier) => tier.status === "unknown").length,
		};
	}, [data?.tiers]);

	if (error) {
		return (
			<div className="p-8">
				<p className="text-destructive">
					Failed to load TCS tier routing status.
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 p-4 md:p-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">
						TCS Tier Routing
					</h1>
					<p className="text-muted-foreground">
						Hourly health checks for each TCS routing tier. Shows which provider
						each tier is currently using and when it was last verified.
					</p>
					{data?.checkedAt ? (
						<p className="mt-2 text-sm text-muted-foreground">
							Last check cycle: {formatRelativeTime(data.checkedAt)}
						</p>
					) : null}
				</div>
				<Button
					variant="outline"
					onClick={() => refetch()}
					disabled={isFetching}
					className="gap-2"
				>
					<RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
					Refresh
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Tiers</CardDescription>
						<CardTitle className="text-2xl">{summary.total}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Healthy</CardDescription>
						<CardTitle className="text-2xl text-emerald-600">
							{summary.healthy}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Failed</CardDescription>
						<CardTitle className="text-2xl text-destructive">
							{summary.failed}
						</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardDescription>Not checked</CardDescription>
						<CardTitle className="text-2xl">{summary.unknown}</CardTitle>
					</CardHeader>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Tier status</CardTitle>
					<CardDescription>
						Checks run hourly via the worker when{" "}
						<code className="text-xs">TCS_TIER_CHECK_ENABLED=true</code>.
						Failure alerts email{" "}
						<code className="text-xs">TCS_TIER_CHECK_ALERT_EMAILS</code>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Tier</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Current provider</TableHead>
								<TableHead>Routing order</TableHead>
								<TableHead>Last checked</TableHead>
								<TableHead>Last success</TableHead>
								<TableHead>Latency</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell colSpan={7} className="text-muted-foreground">
										Loading tier status...
									</TableCell>
								</TableRow>
							) : (data?.tiers ?? []).length === 0 ? (
								<TableRow>
									<TableCell colSpan={7} className="text-muted-foreground">
										No TCS tiers configured.
									</TableCell>
								</TableRow>
							) : (
								data?.tiers.map((tier) => (
									<TableRow key={tier.tierId}>
										<TableCell>
											<div className="font-medium">{tier.tierName}</div>
											<div className="text-xs text-muted-foreground">
												{tier.tierId}
											</div>
											{tier.description ? (
												<div className="mt-1 max-w-xs text-xs text-muted-foreground">
													{tier.description}
												</div>
											) : null}
										</TableCell>
										<TableCell>
											<div className="flex flex-col gap-2">
												<StatusBadge status={tier.status} />
												{tier.lastError ? (
													<p className="max-w-xs text-xs text-destructive">
														{tier.lastError}
													</p>
												) : null}
											</div>
										</TableCell>
										<TableCell>
											{tier.selectedProvider ? (
												<div>
													<div className="font-medium">
														{tier.selectedProvider}
													</div>
													<div className="text-xs text-muted-foreground">
														{tier.selectedModel}
													</div>
												</div>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
										<TableCell className="max-w-md text-xs text-muted-foreground">
											{formatProviderChain(
												tier.primaryProvider,
												tier.primaryModel,
												tier.fallbackProviders,
											)}
										</TableCell>
										<TableCell className="text-sm">
											{formatRelativeTime(tier.lastCheckedAt)}
										</TableCell>
										<TableCell className="text-sm">
											{formatRelativeTime(tier.lastSuccessAt)}
										</TableCell>
										<TableCell className="text-sm tabular-nums">
											{tier.latencyMs !== null && tier.latencyMs !== undefined
												? `${tier.latencyMs} ms`
												: "—"}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
