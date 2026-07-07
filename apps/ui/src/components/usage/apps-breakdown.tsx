"use client";

import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { BreakdownList } from "@/components/usage/breakdown-list";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useApi } from "@/lib/fetch-client";

import type { BreakdownRow } from "@/components/usage/breakdown-list";

interface AppsBreakdownProps {
	projectId: string | undefined;
}

export function AppsBreakdown({ projectId }: AppsBreakdownProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const { buildUrl } = useDashboardNavigation();
	const [metric, setMetric] = useState<"cost" | "requests">("cost");

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity/breakdown",
		{
			params: {
				query: {
					dimension: "apiKey",
					from: fromStr,
					to: toStr,
					...(projectId ? { projectId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	if (!projectId) {
		return (
			<div className="flex h-[280px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view this breakdown
				</p>
			</div>
		);
	}

	const rows: BreakdownRow[] = (data?.breakdown ?? []).map((row) => ({
		key: row.key,
		label: row.label,
		secondaryLabel: row.secondaryLabel,
		requestCount: row.requestCount,
		cost: row.cost,
	}));

	return (
		<BreakdownList
			rows={rows}
			isLoading={isLoading}
			error={!!error}
			metric={metric}
			onMetricChange={setMetric}
			onRowClick={(row) => {
				const params = new URLSearchParams(searchParams);
				params.set("apiKeyId", row.key);
				router.push(`${buildUrl("usage")}?${params.toString()}`);
			}}
			emptyState={
				<div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
					<p className="text-muted-foreground">
						No API key activity in this period
					</p>
					<p className="text-xs text-muted-foreground">
						Spend shows up here as soon as a key is used
					</p>
				</div>
			}
		/>
	);
}
