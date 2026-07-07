"use client";

import { useMemo, useState } from "react";

import { Progress } from "@/lib/components/progress";
import { Tabs, TabsList, TabsTrigger } from "@/lib/components/tabs";
import { cn } from "@/lib/utils";

export interface BreakdownRow {
	key: string;
	label: string;
	secondaryLabel?: string;
	requestCount: number;
	cost: number;
}

interface BreakdownListProps {
	rows: BreakdownRow[];
	isLoading?: boolean;
	error?: boolean;
	emptyState?: React.ReactNode;
	metric: "cost" | "requests";
	onMetricChange: (metric: "cost" | "requests") => void;
	onRowClick?: (row: BreakdownRow) => void;
	maxVisible?: number;
}

function formatCompactCost(value: number): string {
	if (value >= 1_000_000) {
		return `$${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `$${(value / 1_000).toFixed(1)}K`;
	}
	return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function formatCompactCount(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}K`;
	}
	return value.toLocaleString();
}

export function BreakdownList({
	rows,
	isLoading,
	error,
	emptyState,
	metric,
	onMetricChange,
	onRowClick,
	maxVisible = 8,
}: BreakdownListProps) {
	const [showAll, setShowAll] = useState(false);

	const sorted = useMemo(
		() =>
			[...rows].sort((a, b) =>
				metric === "cost" ? b.cost - a.cost : b.requestCount - a.requestCount,
			),
		[rows, metric],
	);

	const total = useMemo(
		() =>
			sorted.reduce(
				(sum, row) => sum + (metric === "cost" ? row.cost : row.requestCount),
				0,
			),
		[sorted, metric],
	);

	const visibleRows = showAll ? sorted : sorted.slice(0, maxVisible);
	const hiddenCount = sorted.length - visibleRows.length;

	const metricSwitcher = (
		<Tabs
			value={metric}
			onValueChange={(v) => onMetricChange(v as "cost" | "requests")}
		>
			<TabsList>
				<TabsTrigger value="cost">Cost</TabsTrigger>
				<TabsTrigger value="requests">Requests</TabsTrigger>
			</TabsList>
		</Tabs>
	);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex justify-end">{metricSwitcher}</div>
				<div className="flex h-[280px] items-center justify-center">
					<p className="text-muted-foreground">Loading breakdown...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex justify-end">{metricSwitcher}</div>
				<div className="flex h-[280px] items-center justify-center">
					<p className="text-destructive">Error loading breakdown data</p>
				</div>
			</div>
		);
	}

	if (sorted.length === 0) {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex justify-end">{metricSwitcher}</div>
				{emptyState ?? (
					<div className="flex h-[200px] items-center justify-center">
						<p className="text-muted-foreground">No data available</p>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">{metricSwitcher}</div>
			<div className="flex flex-col gap-3">
				{visibleRows.map((row) => {
					const value = metric === "cost" ? row.cost : row.requestCount;
					const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
					return (
						<div
							key={row.key}
							role={onRowClick ? "button" : undefined}
							tabIndex={onRowClick ? 0 : undefined}
							onClick={onRowClick ? () => onRowClick(row) : undefined}
							onKeyDown={
								onRowClick
									? (e) => {
											if (e.key === "Enter" || e.key === " ") {
												onRowClick(row);
											}
										}
									: undefined
							}
							className={cn(
								"flex flex-col gap-1.5 rounded-md px-1 py-0.5 -mx-1 text-left transition-colors",
								onRowClick && "hover:bg-muted/50 cursor-pointer",
							)}
						>
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{row.label}</p>
									{row.secondaryLabel && (
										<p className="truncate text-xs text-muted-foreground">
											{row.secondaryLabel}
										</p>
									)}
								</div>
								<div className="flex shrink-0 items-center gap-2 tabular-nums">
									<span className="text-sm font-medium">
										{metric === "cost"
											? formatCompactCost(row.cost)
											: formatCompactCount(row.requestCount)}
									</span>
									<span className="w-10 text-right text-xs text-muted-foreground">
										{percentage}%
									</span>
								</div>
							</div>
							<Progress value={percentage} className="h-1.5" />
						</div>
					);
				})}
			</div>
			{hiddenCount > 0 && (
				<button
					type="button"
					onClick={() => setShowAll((prev) => !prev)}
					className="self-start text-xs font-medium text-muted-foreground hover:text-foreground"
				>
					{showAll ? "Show less" : `+${hiddenCount} more`}
				</button>
			)}
		</div>
	);
}
