"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

export function DashboardIndexRedirect() {
	const router = useRouter();
	const api = useApi();
	const { user, isLoading: userLoading } = useUser({
		redirectTo: "/login",
		redirectWhen: "unauthenticated",
	});

	const { data: organizationsData, isLoading: orgsLoading } = api.useQuery(
		"get",
		"/orgs",
		{},
		{
			enabled: !!user,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
		},
	);

	const defaultOrgId = organizationsData?.organizations?.[0]?.id;

	const { data: projectsData, isLoading: projectsLoading } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{
			params: {
				path: {
					id: defaultOrgId ?? "",
				},
			},
		},
		{
			enabled: !!defaultOrgId,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
		},
	);

	useEffect(() => {
		if (userLoading || !user) {
			return;
		}

		if (!user.onboardingCompleted) {
			router.replace("/onboarding");
			return;
		}

		if (orgsLoading) {
			return;
		}

		const organizations = organizationsData?.organizations ?? [];
		if (organizations.length === 0) {
			router.replace("/onboarding");
			return;
		}

		const orgId = organizations[0].id;

		if (projectsLoading) {
			return;
		}

		const projects = projectsData?.projects ?? [];
		if (projects.length > 0) {
			router.replace(`/dashboard/${orgId}/${projects[0].id}`);
			return;
		}

		router.replace(`/dashboard/${orgId}`);
	}, [
		user,
		userLoading,
		organizationsData,
		orgsLoading,
		projectsData,
		projectsLoading,
		router,
	]);

	return (
		<div className="flex min-h-[50vh] items-center justify-center">
			<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	);
}
