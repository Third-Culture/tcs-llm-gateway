/**
 * Minimal TCS-internal audit event logger.
 *
 * This is a clean-room reimplementation of the API surface previously
 * provided by the proprietary `ee/audit` package. It writes to the same
 * `audit_log` table already defined in `@llmgateway/db` so no schema
 * changes are required. We do not ship any code derived from the upstream
 * EE package.
 */
import {
	auditLog,
	db,
	type AuditLogAction,
	type AuditLogMetadata,
	type AuditLogResourceType,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

export interface LogAuditEventParams {
	organizationId: string;
	userId: string;
	action: AuditLogAction;
	resourceType: AuditLogResourceType;
	resourceId?: string;
	metadata?: AuditLogMetadata;
}

export async function logAuditEvent(
	params: LogAuditEventParams,
): Promise<void> {
	try {
		await db.insert(auditLog).values({
			organizationId: params.organizationId,
			userId: params.userId,
			action: params.action,
			resourceType: params.resourceType,
			resourceId: params.resourceId,
			metadata: params.metadata,
		});
	} catch (error) {
		logger.error("Failed to log audit event", error);
	}
}

export type {
	AuditLogAction,
	AuditLogResourceType,
	AuditLogMetadata,
} from "@llmgateway/db";
