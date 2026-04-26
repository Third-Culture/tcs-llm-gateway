import { randomUUID } from "crypto";

import { redisClient } from "@llmgateway/cache";

import { closeDatabase, db, tables } from "./index.js";

import type { PgTable } from "drizzle-orm/pg-core";

async function upsert<T extends Record<string, unknown>>(
	table: PgTable & Record<string, unknown>,
	values: T,
	uniqueKey: keyof T & string = "id" as keyof T & string,
) {
	return await db
		.insert(table)
		.values(values as never)
		.onConflictDoUpdate({
			target: table[uniqueKey] as never,
			set: values as never,
		});
}

async function seedProd() {
	const apiKey = process.env.SEED_GATEWAY_API_KEY;
	if (!apiKey) {
		throw new Error("SEED_GATEWAY_API_KEY env var is required");
	}

	await upsert(tables.installation, {
		id: "self-hosted-installation",
		uuid: randomUUID(),
		type: "self-host",
	});

	await upsert(tables.user, {
		id: "tcs-enterprise-user",
		name: "Third Culture Enterprise",
		email: "ops@thirdculture.world",
		emailVerified: true,
	});

	await upsert(tables.organization, {
		id: "tcs-enterprise-org",
		name: "Third Culture",
		billingEmail: "ops@thirdculture.world",
		credits: 100000,
		retentionLevel: "retain",
		plan: "enterprise",
	});

	await upsert(tables.userOrganization, {
		id: "tcs-enterprise-user-org",
		userId: "tcs-enterprise-user",
		organizationId: "tcs-enterprise-org",
		role: "owner",
	});

	await upsert(tables.project, {
		id: "tcs-greshi-project",
		name: "Greshi (company refresh)",
		organizationId: "tcs-enterprise-org",
		mode: "credits",
	});

	await upsert(tables.apiKey, {
		id: "tcs-greshi-api-key",
		token: apiKey,
		projectId: "tcs-greshi-project",
		description: "Greshi backend (Cloud Run)",
		createdBy: "tcs-enterprise-user",
		status: "active",
	});

	await closeDatabase();
	await redisClient.quit();
}

void seedProd();
