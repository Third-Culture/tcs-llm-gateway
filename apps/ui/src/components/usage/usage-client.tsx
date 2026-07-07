"use client";

import { differenceInCalendarDays, format, subDays, subHours } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { ActivityChart } from "@/components/dashboard/activity-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { getDateRangeFromParams } from "@/components/date-range-picker";
import {
	TimeRangePicker,
	type TimeRangeValue,
} from "@/components/time-range-picker";
import { AppsBreakdown } from "@/components/usage/apps-breakdown";
import { CacheRateChart } from "@/components/usage/cache-rate-chart";
import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
import { ErrorRateChart } from "@/components/usage/error-rate-chart";
import { ModelUsageTable } from "@/components/usage/model-usage-table";
import { UsersBreakdown } from "@/components/usage/users-breakdown";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";

interface UsageClientProps {
	initialActivityData?: ActivitT;
	projectId: string | undefined;
}

function timeRangeToDateRange(timeRange: TimeRangeValue) {
	const now = new Date();
	switch (timeRange) {
		case "1h":
			return { from: subHours(now, 1), to: now };
		case "4h":
			return { from: subHours(now, 4), to: now };
		case "24h":
			return { from: subDays(now, 1), to: now };
		case "7d":
			return { from: subDays(now, 7), to: now };
		case "30d":
			return { from: subDays(now, 30), to: now };
	}
}

interface ActivityTotals {
	cost: number;
	requests: number;
	errors: number;
	cache: number;
}

interface ActivityDaySummary {
	cost: number;
	requestCount: number;
	errorCount: number;
	cacheCount: number;
}

function sumActivity(
	activity: ActivityDaySummary[] | undefined,
): ActivityTotals {
	return (activity ?? []).reduce<ActivityTotals>(
		(acc, day) => ({
			cost: acc.cost + day.cost,
			requests: acc.requests + day.requestCount,
			errors: acc.errors + day.errorCount,
			cache: acc.cache + day.cacheCount,
		}),
		{ cost: 0, requests: 0, errors: 0, cache: 0 },
	);
}

function trendLabel(
	current: number,
	previous: number,
	periodDays: number,
): string | undefined {
	if (previous <= 0) {
		return current > 0 ? "New this period" : undefined;
	}
	const change = ((current - previous) / previous) * 100;
	const arrow = change >= 0 ? "▲" : "▼";
	return `${arrow} ${Math.abs(change).toFixed(0)}% vs previous ${periodDays}d`;
}

function CardSubtitle({ range, trend }: { range: string; trend?: string }) {
	return (
		<span className="flex flex-col gap-0.5">
			<span>{range}</span>
			{trend && <span className="text-muted-foreground/70">{trend}</span>}
		</span>
	);
}

export function UsageClient({
	initialActivityData,
	projectId,
}: UsageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();

	// Fetch API keys for the project
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId ?? "",
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	const apiKeys =
		apiKeysData?.apiKeys.filter((key) => key.status !== "deleted") ?? [];

	// Get apiKeyId and timeRange from URL
	const apiKeyId = searchParams.get("apiKeyId") ?? undefined;
	const timeRange = (searchParams.get("timeRange") as TimeRangeValue) ?? "7d";

	// If no from/to params, set them based on timeRange
	useEffect(() => {
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const { from, to } = timeRangeToDateRange(timeRange);
			const params = new URLSearchParams(searchParams);
			params.delete("days");
			params.set("from", format(from, "yyyy-MM-dd"));
			params.set("to", format(to, "yyyy-MM-dd"));
			if (!params.has("timeRange")) {
				params.set("timeRange", timeRange);
			}
			router.replace(`${buildUrl("usage")}?${params.toString()}`);
		}
	}, [searchParams, router, buildUrl, timeRange]);

	// Function to update apiKeyId in URL
	const updateApiKeyIdInUrl = (newApiKeyId: string | undefined) => {
		const params = new URLSearchParams(searchParams);
		if (newApiKeyId) {
			params.set("apiKeyId", newApiKeyId);
		} else {
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	// Function to update timeRange in URL
	const updateTimeRange = (newTimeRange: TimeRangeValue) => {
		const { from, to } = timeRangeToDateRange(newTimeRange);
		const params = new URLSearchParams(searchParams);
		params.set("timeRange", newTimeRange);
		params.set("from", format(from, "yyyy-MM-dd"));
		params.set("to", format(to, "yyyy-MM-dd"));
		params.delete("days");
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const periodDays = differenceInCalendarDays(to, from) + 1;
	const prevTo = subDays(from, 1);
	const prevFrom = subDays(prevTo, periodDays - 1);
	const prevFromStr = format(prevFrom, "yyyy-MM-dd");
	const prevToStr = format(prevTo, "yyyy-MM-dd");

	const { data: currentActivity, isLoading: currentLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					...(projectId ? { projectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
			initialData: apiKeyId ? undefined : initialActivityData,
		},
	);

	const { data: previousActivity } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: prevFromStr,
					to: prevToStr,
					...(projectId ? { projectId } : {}),
					...(apiKeyId ? { apiKeyId } : {}),
				},
			},
		},
		{ enabled: !!projectId },
	);

	const current = sumActivity(currentActivity?.activity);
	const previous = sumActivity(previousActivity?.activity);

	const errorRate =
		current.requests > 0 ? (current.errors / current.requests) * 100 : 0;
	const cacheRate =
		current.requests > 0 ? (current.cache / current.requests) * 100 : 0;
	const prevErrorRate =
		previous.requests > 0 ? (previous.errors / previous.requests) * 100 : 0;
	const prevCacheRate =
		previous.requests > 0 ? (previous.cache / previous.requests) * 100 : 0;

	const rangeLabel = `${format(from, "MMM d")} - ${format(to, "MMM d")}`;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">
							Usage & Metrics
						</h2>
						<p className="text-sm text-muted-foreground mt-1">
							What you&apos;re spending, who&apos;s driving it, and whether
							it&apos;s healthy.
						</p>
					</div>
					<div className="flex items-center space-x-2">
						<Select
							value={apiKeyId ?? "all"}
							onValueChange={(value) =>
								updateApiKeyIdInUrl(value === "all" ? undefined : value)
							}
						>
							<SelectTrigger size="sm" className="w-[180px]">
								<SelectValue placeholder="All API Keys" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API Keys</SelectItem>
								{apiKeys.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.description}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TimeRangePicker value={timeRange} onChange={updateTimeRange} />
					</div>
				</div>

				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<MetricCard
						label="Total Cost"
						value={
							currentLoading ? "Loading..." : `$${current.cost.toFixed(2)}`
						}
						subtitle={
							currentLoading ? (
								"–"
							) : (
								<CardSubtitle
									range={rangeLabel}
									trend={trendLabel(current.cost, previous.cost, periodDays)}
								/>
							)
						}
						accent="purple"
					/>
					<MetricCard
						label="Total Requests"
						value={
							currentLoading ? "Loading..." : current.requests.toLocaleString()
						}
						subtitle={
							currentLoading ? (
								"–"
							) : (
								<CardSubtitle
									range={rangeLabel}
									trend={trendLabel(
										current.requests,
										previous.requests,
										periodDays,
									)}
								/>
							)
						}
						accent="blue"
					/>
					<MetricCard
						label="Error Rate"
						value={currentLoading ? "Loading..." : `${errorRate.toFixed(2)}%`}
						subtitle={
							currentLoading ? (
								"–"
							) : (
								<CardSubtitle
									range={rangeLabel}
									trend={trendLabel(errorRate, prevErrorRate, periodDays)}
								/>
							)
						}
						accent={errorRate > 1 ? "purple" : "green"}
					/>
					<MetricCard
						label="Cache Hit Rate"
						value={currentLoading ? "Loading..." : `${cacheRate.toFixed(1)}%`}
						subtitle={
							currentLoading ? (
								"–"
							) : (
								<CardSubtitle
									range={rangeLabel}
									trend={trendLabel(cacheRate, prevCacheRate, periodDays)}
								/>
							)
						}
						accent="green"
					/>
				</div>

				<Tabs defaultValue="overview" className="space-y-4">
					<TabsList>
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="apps">Apps & Services</TabsTrigger>
						<TabsTrigger value="users">Users</TabsTrigger>
						<TabsTrigger value="models">Models</TabsTrigger>
						<TabsTrigger value="errors">Errors</TabsTrigger>
						<TabsTrigger value="cache">Cache</TabsTrigger>
					</TabsList>

					<TabsContent value="overview" className="space-y-4">
						<div className="grid gap-4 lg:grid-cols-7">
							<div className="lg:col-span-4">
								<ActivityChart
									initialData={apiKeyId ? undefined : initialActivityData}
									apiKeyId={apiKeyId}
									timeRange={timeRange}
									title="Usage Overview"
									defaultMetric="cost"
								/>
							</div>
							<Card className="lg:col-span-3">
								<CardHeader>
									<CardTitle>Cost Breakdown</CardTitle>
									<CardDescription>
										Estimated costs by provider and model
									</CardDescription>
								</CardHeader>
								<CardContent>
									<CostBreakdownChart
										initialData={apiKeyId ? undefined : initialActivityData}
										projectId={projectId}
										apiKeyId={apiKeyId}
									/>
								</CardContent>
							</Card>
						</div>
					</TabsContent>

					<TabsContent value="apps" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Apps & Services</CardTitle>
								<CardDescription>
									Spend and requests by API key — click a row to drill in
								</CardDescription>
							</CardHeader>
							<CardContent>
								<AppsBreakdown projectId={projectId} />
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="users" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Users</CardTitle>
								<CardDescription>
									Spend by the team member who created each key, or by a custom
									request metadata header
								</CardDescription>
							</CardHeader>
							<CardContent>
								<UsersBreakdown projectId={projectId} />
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="models" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Top Used Models</CardTitle>
								<CardDescription>Usage breakdown by model</CardDescription>
							</CardHeader>
							<CardContent>
								<ModelUsageTable
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="errors" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Error Rate</CardTitle>
								<CardDescription>
									API request error rate over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ErrorRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>

					<TabsContent value="cache" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cache Rate</CardTitle>
								<CardDescription>
									API request cache rate over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<CacheRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
