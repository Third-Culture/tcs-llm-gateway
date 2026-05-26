"use client";

import { format, parseISO } from "date-fns";
import {
	Activity,
	DollarSign,
	ExternalLink,
	TrendingDown,
	TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { MetricCard } from "@/components/dashboard/metric-card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/lib/components/chart";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { ChartConfig } from "@/lib/components/chart";

type CostWindow = "7d" | "30d" | "90d" | "365d";

const WINDOW_OPTIONS: { value: CostWindow; label: string }[] = [
	{ value: "7d", label: "7 days" },
	{ value: "30d", label: "30 days" },
	{ value: "90d", label: "90 days" },
	{ value: "365d", label: "1 year" },
];

const chartConfig = {
	inputCost: {
		label: "Input",
		color: "hsl(var(--chart-1))",
	},
	outputCost: {
		label: "Output",
		color: "hsl(var(--chart-2))",
	},
} satisfies ChartConfig;

function formatUsd(value: number, compact = false): string {
	if (compact) {
		if (value >= 1_000_000) {
			return `$${(value / 1_000_000).toFixed(2)}M`;
		}
		if (value >= 1_000) {
			return `$${(value / 1_000).toFixed(1)}K`;
		}
	}
	if (value >= 0.01) {
		return `$${value.toFixed(2)}`;
	}
	if (value >= 0.0001) {
		return `$${value.toFixed(4)}`;
	}
	return `$${value.toFixed(6)}`;
}

function formatAxisLabel(
	timestamp: string,
	granularity: "hour" | "day",
): string {
	const date = parseISO(timestamp);
	return granularity === "hour"
		? format(date, "MMM d, ha")
		: format(date, "MMM d");
}

export function CostMonitorClient() {
	const api = useApi();
	const [window, setWindow] = useState<CostWindow>("7d");

	const { data: timeseries, isLoading: isTimeseriesLoading } = api.useQuery(
		"get",
		"/admin/metrics/cost-timeseries",
		{
			params: { query: { window } },
		},
	);

	const { data: costByKey, isLoading: isKeyLoading } = api.useQuery(
		"get",
		"/admin/metrics/cost-by-key",
		{
			params: { query: { window } },
		},
	);

	const chartData = useMemo(() => {
		if (!timeseries?.data) {
			return [];
		}
		return timeseries.data.map((point) => ({
			...point,
			label: formatAxisLabel(point.timestamp, timeseries.granularity),
		}));
	}, [timeseries]);

	const totals = timeseries?.totals;
	const avgPerBucket =
		chartData.length > 0 && totals ? totals.cost / chartData.length : 0;
	const avgPerRequest =
		totals && totals.requests > 0 ? totals.cost / totals.requests : 0;

	const serviceData = useMemo(() => {
		if (!costByKey?.keys) {
			return [];
		}
		return costByKey.keys.slice(0, 10).map((k) => ({
			name: k.description ?? k.apiKeyId.slice(0, 12),
			cost: k.cost,
			requests: k.requestCount,
		}));
	}, [costByKey]);

	const isLoading = isTimeseriesLoading || isKeyLoading;

	return (
		<div className="space-y-8">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-500">
						Cost monitor
					</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
						Platform spend
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-muted-foreground">
						Real inference cost from hourly usage rollups — the same numbers
						behind gateway{" "}
						<code className="rounded bg-muted px-1 py-0.5 text-xs">
							usage.cost
						</code>
						.
					</p>
				</div>
				<div className="flex flex-col items-end gap-3">
					<div className="inline-flex rounded-xl border border-border/60 bg-card p-1 shadow-sm">
						{WINDOW_OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								onClick={() => setWindow(option.value)}
								className={cn(
									"rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
									window === option.value
										? "bg-emerald-500 text-white shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Primary cost metrics */}
			<div className="grid gap-4 sm:grid-cols-3">
				<MetricCard
					label="Total spend"
					value={isLoading ? "…" : formatUsd(totals?.cost ?? 0)}
					subtitle={`Last ${window}`}
					icon={<DollarSign className="size-4" />}
					accent="green"
				/>
				<MetricCard
					label="Input cost"
					value={isLoading ? "…" : formatUsd(totals?.inputCost ?? 0)}
					subtitle="Prompt tokens"
					icon={<TrendingUp className="size-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Output cost"
					value={isLoading ? "…" : formatUsd(totals?.outputCost ?? 0)}
					subtitle="Completion tokens"
					icon={<TrendingDown className="size-4" />}
					accent="purple"
				/>
			</div>

			{/* Secondary metrics */}
			<div className="grid gap-4 sm:grid-cols-2">
				<MetricCard
					label="Avg cost per request"
					value={isLoading ? "…" : formatUsd(avgPerRequest)}
					subtitle="Total spend ÷ requests"
					icon={<Activity className="size-4" />}
					accent="green"
				/>
				<MetricCard
					label={`Avg per ${timeseries?.granularity ?? "bucket"}`}
					value={isLoading ? "…" : formatUsd(avgPerBucket)}
					subtitle="Spend smoothed over period"
					icon={<DollarSign className="size-4" />}
					accent="blue"
				/>
			</div>

			{/* Cost over time chart */}
			<div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
				<div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
					<div>
						<h2 className="text-base font-semibold">Cost over time</h2>
						<p className="text-sm text-muted-foreground">
							Input vs output spend stacked by{" "}
							{timeseries?.granularity === "hour" ? "hour" : "day"}
						</p>
					</div>
					<div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
						<span className="inline-flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-[hsl(var(--chart-1))]" />
							Input
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="size-2 rounded-full bg-[hsl(var(--chart-2))]" />
							Output
						</span>
					</div>
				</div>
				<div className="px-2 py-4 sm:px-4">
					{isLoading ? (
						<div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
							Loading cost series…
						</div>
					) : chartData.length === 0 ? (
						<div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
							No usage recorded in this period.
						</div>
					) : (
						<ChartContainer config={chartConfig} className="h-[320px] w-full">
							<AreaChart
								data={chartData}
								margin={{ left: 8, right: 8, top: 8 }}
							>
								<defs>
									<linearGradient id="inputFill" x1="0" y1="0" x2="0" y2="1">
										<stop
											offset="5%"
											stopColor="var(--color-inputCost)"
											stopOpacity={0.35}
										/>
										<stop
											offset="95%"
											stopColor="var(--color-inputCost)"
											stopOpacity={0.02}
										/>
									</linearGradient>
									<linearGradient id="outputFill" x1="0" y1="0" x2="0" y2="1">
										<stop
											offset="5%"
											stopColor="var(--color-outputCost)"
											stopOpacity={0.35}
										/>
										<stop
											offset="95%"
											stopColor="var(--color-outputCost)"
											stopOpacity={0.02}
										/>
									</linearGradient>
								</defs>
								<CartesianGrid vertical={false} strokeDasharray="3 3" />
								<XAxis
									dataKey="label"
									tickLine={false}
									axisLine={false}
									minTickGap={24}
									tick={{ fontSize: 11 }}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={56}
									tickFormatter={(value: number) => formatUsd(value, true)}
									tick={{ fontSize: 11 }}
								/>
								<ChartTooltip
									content={
										<ChartTooltipContent
											labelFormatter={(_, payload) =>
												payload?.[0]?.payload?.label ?? ""
											}
											formatter={(value, name) => (
												<span className="font-mono tabular-nums">
													{formatUsd(Number(value))} {String(name)}
												</span>
											)}
										/>
									}
								/>
								<Area
									type="monotone"
									dataKey="inputCost"
									stackId="cost"
									stroke="var(--color-inputCost)"
									fill="url(#inputFill)"
									strokeWidth={2}
								/>
								<Area
									type="monotone"
									dataKey="outputCost"
									stackId="cost"
									stroke="var(--color-outputCost)"
									fill="url(#outputFill)"
									strokeWidth={2}
								/>
							</AreaChart>
						</ChartContainer>
					)}
				</div>
			</div>

			{/* Cost by service */}
			<div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
				<div className="border-b border-border/60 px-6 py-4">
					<h2 className="text-base font-semibold">Cost by service</h2>
					<p className="text-sm text-muted-foreground">
						Spend by API key / TCS service in this window
					</p>
				</div>
				<div className="px-4 py-4">
					{isKeyLoading ? (
						<div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
							Loading service breakdown…
						</div>
					) : serviceData.length === 0 ? (
						<div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
							No service usage yet.
						</div>
					) : (
						<div className="h-64">
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={serviceData}
									layout="vertical"
									margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
								>
									<CartesianGrid horizontal={false} strokeDasharray="3 3" />
									<XAxis
										type="number"
										tickFormatter={(value: number) => formatUsd(value, true)}
										tick={{ fontSize: 11 }}
									/>
									<YAxis
										type="category"
										dataKey="name"
										width={140}
										tick={{ fontSize: 11 }}
									/>
									<Tooltip
										formatter={(value: number) => formatUsd(value)}
										labelFormatter={(label) => String(label)}
									/>
									<Bar
										dataKey="cost"
										fill="hsl(160 84% 39%)"
										radius={[0, 6, 6, 0]}
									/>
								</BarChart>
							</ResponsiveContainer>
						</div>
					)}
				</div>
			</div>

			{/* Full admin portal link */}
			<div className="flex justify-center">
				<Link
					href={
						process.env.NODE_ENV === "development"
							? "http://localhost:3006"
							: "https://admin.llmgateway.io"
					}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-5 py-3 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-emerald-500/40 hover:text-foreground"
				>
					<ExternalLink className="size-4 text-emerald-500" />
					Full admin dashboard
				</Link>
			</div>
		</div>
	);
}
