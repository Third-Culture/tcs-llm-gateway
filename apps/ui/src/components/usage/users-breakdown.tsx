"use client";

import { format } from "date-fns";
import { BookOpen } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { getDateRangeFromParams } from "@/components/date-range-picker";
import { BreakdownList } from "@/components/usage/breakdown-list";
import { Button } from "@/lib/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import { useApi } from "@/lib/fetch-client";

import type { BreakdownRow } from "@/components/usage/breakdown-list";

interface UsersBreakdownProps {
	projectId: string | undefined;
}

function metadataKeyLabel(key: string): string {
	return key
		.split("-")
		.map((part) =>
			part.toLowerCase() === "id"
				? "ID"
				: part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join(" ");
}

export function UsersBreakdown({ projectId }: UsersBreakdownProps) {
	const searchParams = useSearchParams();
	const [metric, setMetric] = useState<"cost" | "requests">("cost");
	const [lens, setLens] = useState<"team" | "metadata">("team");
	const [selectedMetadataKey, setSelectedMetadataKey] = useState<string>();

	const { from, to } = getDateRangeFromParams(searchParams);
	const fromStr = format(from, "yyyy-MM-dd");
	const toStr = format(to, "yyyy-MM-dd");

	const api = useApi();

	const {
		data: teamData,
		isLoading: teamLoading,
		error: teamError,
	} = api.useQuery(
		"get",
		"/activity/breakdown",
		{
			params: {
				query: {
					dimension: "user",
					from: fromStr,
					to: toStr,
					...(projectId ? { projectId } : {}),
				},
			},
		},
		{ enabled: !!projectId },
	);

	const { data: metadataKeysData } = api.useQuery(
		"get",
		"/activity/breakdown/metadata-keys",
		{
			params: {
				query: {
					...(projectId ? { projectId } : {}),
				},
			},
		},
		{ enabled: !!projectId, staleTime: 5 * 60 * 1000 },
	);

	const metadataKeys = useMemo(
		() => metadataKeysData?.keys ?? [],
		[metadataKeysData],
	);

	useEffect(() => {
		if (!selectedMetadataKey && metadataKeys.length > 0) {
			setSelectedMetadataKey(
				metadataKeys.includes("user-id") ? "user-id" : metadataKeys[0],
			);
		}
	}, [metadataKeys, selectedMetadataKey]);

	const {
		data: metadataData,
		isLoading: metadataLoading,
		error: metadataError,
	} = api.useQuery(
		"get",
		"/activity/breakdown/metadata",
		{
			params: {
				query: {
					metadataKey: selectedMetadataKey ?? "",
					from: fromStr,
					to: toStr,
					...(projectId ? { projectId } : {}),
				},
			},
		},
		{ enabled: !!projectId && lens === "metadata" && !!selectedMetadataKey },
	);

	const teamRows: BreakdownRow[] = useMemo(
		() =>
			(teamData?.breakdown ?? []).map((row) => ({
				key: row.key,
				label: row.label,
				secondaryLabel: row.secondaryLabel,
				requestCount: row.requestCount,
				cost: row.cost,
			})),
		[teamData],
	);

	const metadataRows: BreakdownRow[] = useMemo(
		() =>
			(metadataData?.breakdown ?? []).map((row) => ({
				key: row.key,
				label: row.key,
				requestCount: row.requestCount,
				cost: row.cost,
			})),
		[metadataData],
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

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<Tabs
					value={lens}
					onValueChange={(v) => setLens(v as "team" | "metadata")}
				>
					<TabsList>
						<TabsTrigger value="team">By team member</TabsTrigger>
						<TabsTrigger value="metadata">By custom metadata</TabsTrigger>
					</TabsList>
				</Tabs>
				{lens === "metadata" && metadataKeys.length > 0 && (
					<Select
						value={selectedMetadataKey}
						onValueChange={setSelectedMetadataKey}
					>
						<SelectTrigger size="sm" className="w-[160px]">
							<SelectValue placeholder="Select metadata key" />
						</SelectTrigger>
						<SelectContent>
							{metadataKeys.map((key) => (
								<SelectItem key={key} value={key}>
									{metadataKeyLabel(key)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
			</div>

			{lens === "team" ? (
				<BreakdownList
					rows={teamRows}
					isLoading={teamLoading}
					error={!!teamError}
					metric={metric}
					onMetricChange={setMetric}
					emptyState={
						<div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
							<p className="text-muted-foreground">
								No team member activity in this period
							</p>
						</div>
					}
				/>
			) : metadataKeys.length === 0 ? (
				<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
					<p className="max-w-md text-sm text-muted-foreground">
						Send an{" "}
						<code className="rounded bg-muted px-1 py-0.5 text-xs">
							X-LLMGateway-User-ID
						</code>{" "}
						header with your requests to see spend broken down by end user,
						tenant, feature, or any other dimension you choose.
					</p>
					<Button asChild variant="outline" size="sm">
						<a
							href="https://docs.llmgateway.io/features/metadata"
							target="_blank"
							rel="noopener noreferrer"
						>
							<BookOpen className="mr-2 h-4 w-4" />
							View metadata docs
						</a>
					</Button>
				</div>
			) : (
				<BreakdownList
					rows={metadataRows}
					isLoading={metadataLoading}
					error={!!metadataError}
					metric={metric}
					onMetricChange={setMetric}
					emptyState={
						<div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center">
							<p className="text-muted-foreground">
								No requests with this metadata key in this period
							</p>
						</div>
					}
				/>
			)}
		</div>
	);
}
