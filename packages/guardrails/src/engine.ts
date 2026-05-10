/**
 * TCS no-op guardrails engine.
 *
 * Third Culture runs this gateway internal-only, so we ship a no-op
 * replacement for the proprietary EE guardrails package. All APIs resolve to
 * "no violation" / "passthrough", preserving the type signatures that the
 * upstream gateway expects. If we ever want real content filtering we can
 * layer it inside this package without changing any call sites.
 */
import type {
	GuardrailConfigData,
	GuardrailInput,
	GuardrailResult,
	Message,
	RedactionInfo,
	RuleViolation,
} from "./types.js";

export async function checkGuardrails(
	_input: GuardrailInput,
): Promise<GuardrailResult> {
	return {
		passed: true,
		blocked: false,
		violations: [],
		redactions: [],
		rulesChecked: 0,
	};
}

export async function getGuardrailConfig(
	_organizationId: string,
): Promise<GuardrailConfigData | null> {
	return null;
}

export async function logViolation(
	_organizationId: string,
	_violation: RuleViolation,
	_context?: { apiKeyId?: string; model?: string },
): Promise<void> {
	// No-op. Violations can never occur because checkGuardrails returns empty.
}

export function applyRedactions(
	messages: Message[],
	_redactions: RedactionInfo[],
): Message[] {
	return messages;
}
