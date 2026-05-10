export {
	checkGuardrails,
	getGuardrailConfig,
	logViolation,
	applyRedactions,
} from "./engine.js";

export type {
	GuardrailConfigData,
	RuleViolation,
	RedactionInfo,
	GuardrailResult,
	GuardrailInput,
	Message,
	MessageContent,
	FileInfo,
	SystemRule,
	SystemRuleId,
} from "./types.js";

export const systemRules: readonly never[] = [];

export type {
	GuardrailAction,
	SystemRuleConfig,
	SystemRulesConfig,
	BlockedTermsRuleConfig,
	CustomRegexRuleConfig,
	TopicRestrictionRuleConfig,
	CustomRuleConfig,
	GuardrailActionTaken,
	CustomRuleType,
} from "@llmgateway/db";

export {
	guardrailConfig,
	guardrailRule,
	guardrailViolation,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
} from "@llmgateway/db";
