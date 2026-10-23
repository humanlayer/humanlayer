import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { HostModelCatalogEntry } from '@humanlayer/schemas/zod/model-catalog'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

/** Effort levels supported by Claude models, in ascending order of reasoning effort. */
export type ClaudeEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** Reasoning levels supported by Codex (OpenAI) models, in ascending order. */
export type CodexReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
/** Union of all effort/reasoning levels across supported coding agents. */
export type EffortLevel = ClaudeEffortLevel | CodexReasoningLevel

const CODELAYER_AUTH_ERROR_PROVIDERS = [
	'anthropic',
	'codex',
	'github-copilot',
	'copilot',
	'fireworks',
	'firepass',
] as const
const CodelayerAuthErrorProvider = Schema.Literals(CODELAYER_AUTH_ERROR_PROVIDERS)
type CodelayerAuthErrorProvider = typeof CodelayerAuthErrorProvider.Type

const CODELAYER_AUTH_ERROR_PROVIDER_LABELS: Record<CodelayerAuthErrorProvider, string> = {
	anthropic: 'Anthropic (API)',
	codex: 'OpenAI Codex',
	'github-copilot': 'GitHub Copilot',
	copilot: 'GitHub Copilot',
	fireworks: 'Firepass',
	firepass: 'Firepass',
}

const CODELAYER_AUTH_ERROR_PATTERN = /auth for provider:\s*([\w-]+)/i

const CLAUDE_BASE: ClaudeEffortLevel[] = ['low', 'medium', 'high']
const CLAUDE_WITH_MAX: ClaudeEffortLevel[] = [...CLAUDE_BASE, 'max']
const CLAUDE_WITH_XHIGH_MAX: ClaudeEffortLevel[] = [...CLAUDE_BASE, 'xhigh', 'max']

const CLAUDE_EFFORT_MODELS = [
	'claude-fable-5-1',
	'claude-fable-5',
	'opus',
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'sonnet',
	'claude-sonnet-5-5',
	'claude-sonnet-5',
	'claude-opus-4-6',
	'claude-opus-4-6-1m',
	'claude-sonnet-4-6',
	'claude-opus-4-5',
] as const
const ClaudeEffortModel = Schema.Literals(CLAUDE_EFFORT_MODELS)
type ClaudeEffortModel = typeof ClaudeEffortModel.Type

/** Effort levels available per Claude model id. Models absent from this map don't support effort selection. */
export const CLAUDE_EFFORT_LEVELS_BY_MODEL: Record<ClaudeEffortModel, ClaudeEffortLevel[]> = {
	'claude-fable-5-1': CLAUDE_WITH_XHIGH_MAX,
	'claude-fable-5': CLAUDE_WITH_XHIGH_MAX,
	opus: CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-5-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-8': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-7': CLAUDE_WITH_XHIGH_MAX,
	sonnet: CLAUDE_WITH_XHIGH_MAX,
	'claude-sonnet-5-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-sonnet-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-6': CLAUDE_WITH_MAX,
	'claude-opus-4-6-1m': CLAUDE_WITH_MAX,
	'claude-sonnet-4-6': CLAUDE_WITH_MAX,
	'claude-opus-4-5': CLAUDE_BASE,
}

const CODELAYER_ANTHROPIC_EFFORT_MODELS = [
	'claude-fable-5',
	'opus',
	'claude-opus-5-5',
	'claude-opus-5',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'sonnet',
	'claude-sonnet-5-5',
	'claude-sonnet-5',
	'claude-opus-4-6',
	'claude-sonnet-4-6',
] as const
const CodelayerAnthropicEffortModel = Schema.Literals(CODELAYER_ANTHROPIC_EFFORT_MODELS)
type CodelayerAnthropicEffortModel = typeof CodelayerAnthropicEffortModel.Type

/** CodeLayer Anthropic models that support adaptive thinking effort. Opus 4.5 is intentionally excluded. */
export const CODELAYER_ANTHROPIC_EFFORT_LEVELS_BY_MODEL: Record<CodelayerAnthropicEffortModel, ClaudeEffortLevel[]> = {
	'claude-fable-5': CLAUDE_WITH_XHIGH_MAX,
	opus: CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-5-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-8': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-7': CLAUDE_WITH_XHIGH_MAX,
	sonnet: CLAUDE_WITH_XHIGH_MAX,
	'claude-sonnet-5-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-sonnet-5': CLAUDE_WITH_XHIGH_MAX,
	'claude-opus-4-6': CLAUDE_WITH_MAX,
	'claude-sonnet-4-6': CLAUDE_WITH_MAX,
}

const CODEX_ALL: CodexReasoningLevel[] = ['low', 'medium', 'high', 'xhigh']
// GPT-5.6 also advertises ultra, but that mode assumes Codex CLI spawn-agent tools we do not expose.
const CODEX_WITH_MAX: CodexReasoningLevel[] = [...CODEX_ALL, 'max']

const CODEX_REASONING_MODELS = [
	'gpt-6.1-sol',
	'gpt-6-astra',
	'gpt-6-sol',
	'gpt-6-luna',
	'gpt-5.6-sol',
	'gpt-5.6-terra',
	'gpt-5.6-luna',
	'gpt-5.5',
	'gpt-5.4',
	'gpt-5.4-mini',
] as const
const CodexReasoningModel = Schema.Literals(CODEX_REASONING_MODELS)
type CodexReasoningModel = typeof CodexReasoningModel.Type

/** Reasoning levels available per Codex model id. Models absent from this map don't support reasoning selection. */
export const CODEX_REASONING_LEVELS_BY_MODEL: Record<CodexReasoningModel, CodexReasoningLevel[]> = {
	'gpt-6.1-sol': CODEX_WITH_MAX,
	'gpt-6-astra': CODEX_WITH_MAX,
	'gpt-6-sol': CODEX_WITH_MAX,
	'gpt-6-luna': CODEX_WITH_MAX,
	'gpt-5.6-sol': CODEX_WITH_MAX,
	'gpt-5.6-terra': CODEX_WITH_MAX,
	'gpt-5.6-luna': CODEX_WITH_MAX,
	'gpt-5.5': CODEX_ALL,
	'gpt-5.4': CODEX_ALL,
	'gpt-5.4-mini': CODEX_ALL,
}

/**
 * Fold reasoning policy enforced at the Riptide API boundary.
 *
 * packages/ai cannot depend on Fold's daemon-only packages, so this intentionally mirrors the
 * Codex models exposed by Riptide rather than claiming that CodeLayer and Fold share one policy.
 */
const FOLD_CODEX_REASONING_MODELS = [
	'gpt-6.1-sol',
	'gpt-6-astra',
	'gpt-6-sol',
	'gpt-6-luna',
	'gpt-5.6-sol',
	'gpt-5.6-terra',
	'gpt-5.6-luna',
	'gpt-5.5',
	'gpt-5.4',
	'gpt-5.4-mini',
] as const
const FoldCodexReasoningModel = Schema.Literals(FOLD_CODEX_REASONING_MODELS)
type FoldCodexReasoningModel = typeof FoldCodexReasoningModel.Type

export const FOLD_CODEX_REASONING_LEVELS_BY_MODEL: Record<FoldCodexReasoningModel, CodexReasoningLevel[]> = {
	'gpt-6.1-sol': CODEX_WITH_MAX,
	'gpt-6-astra': CODEX_WITH_MAX,
	'gpt-6-sol': CODEX_WITH_MAX,
	'gpt-6-luna': CODEX_WITH_MAX,
	'gpt-5.6-sol': CODEX_WITH_MAX,
	'gpt-5.6-terra': CODEX_WITH_MAX,
	'gpt-5.6-luna': CODEX_WITH_MAX,
	'gpt-5.5': CODEX_ALL,
	'gpt-5.4': CODEX_ALL,
	'gpt-5.4-mini': CODEX_ALL,
}

const FOLD_XAI_REASONING_MODELS = ['grok-4.5', 'grok-4.6'] as const
const FoldXaiReasoningModel = Schema.Literals(FOLD_XAI_REASONING_MODELS)
type FoldXaiReasoningModel = typeof FoldXaiReasoningModel.Type

export const FOLD_XAI_REASONING_LEVELS_BY_MODEL: Record<FoldXaiReasoningModel, CodexReasoningLevel[]> = {
	'grok-4.5': CODEX_ALL,
	'grok-4.6': CODEX_ALL,
}

/**
 * Claude models that are eligible for Fast Mode.
 * Fast Mode for Claude is disabled for now; this set is retained for later phases.
 */
export const FAST_MODE_ELIGIBLE_CLAUDE_MODELS: ReadonlySet<string> = new Set([
	'opus',
	'claude-opus-4-8',
	'claude-opus-4-7',
	'claude-opus-4-6',
	'claude-opus-4-6-1m',
])

/** Codex models that are eligible for Fast Mode. */
export const FAST_MODE_ELIGIBLE_CODEX_MODELS: ReadonlySet<string> = new Set([
	'gpt-6-astra',
	'gpt-6-sol',
	'gpt-6-luna',
	'gpt-5.6-sol',
	'gpt-5.6-terra',
	'gpt-5.6-luna',
	'gpt-5.5',
	'gpt-5.4',
])

/** Codex models whose Fast Mode we withhold even when the Codex backend offers a priority tier. */
const FAST_MODE_WITHHELD_CODEX_MODELS: ReadonlySet<string> = new Set(['gpt-6.1-sol'])

/** Effort level used for Claude sessions when none is explicitly selected. */
export const DEFAULT_CLAUDE_EFFORT: ClaudeEffortLevel = 'high'
/** Reasoning level used for Codex sessions when none is explicitly selected. */
export const DEFAULT_CODEX_REASONING: CodexReasoningLevel = 'medium'

function claudeEffortLevels(model: string): ClaudeEffortLevel[] | undefined {
	return Option.match(Schema.decodeUnknownOption(ClaudeEffortModel)(model), {
		onNone: () => undefined,
		onSome: (knownModel) => CLAUDE_EFFORT_LEVELS_BY_MODEL[knownModel],
	})
}

function codelayerAnthropicEffortLevels(model: string): ClaudeEffortLevel[] | undefined {
	return Option.match(Schema.decodeUnknownOption(CodelayerAnthropicEffortModel)(model), {
		onNone: () => undefined,
		onSome: (knownModel) => CODELAYER_ANTHROPIC_EFFORT_LEVELS_BY_MODEL[knownModel],
	})
}

function codexReasoningLevels(
	model: string,
	schema: typeof CodexReasoningModel,
	policy: Readonly<Record<string, CodexReasoningLevel[]>>,
): CodexReasoningLevel[] | undefined {
	return Option.match(Schema.decodeUnknownOption(schema)(model), {
		onNone: () => undefined,
		onSome: (knownModel) => policy[knownModel],
	})
}

function foldXaiReasoningLevels(model: string): CodexReasoningLevel[] | undefined {
	return Option.match(Schema.decodeUnknownOption(FoldXaiReasoningModel)(model), {
		onNone: () => undefined,
		onSome: (knownModel) => FOLD_XAI_REASONING_LEVELS_BY_MODEL[knownModel],
	})
}

function normalizeClaudeModel(model: string): string {
	if (
		Option.isSome(Schema.decodeUnknownOption(ClaudeEffortModel)(model)) ||
		FAST_MODE_ELIGIBLE_CLAUDE_MODELS.has(model)
	) {
		return model
	}
	if (model.includes('haiku')) return model
	if (model === 'fable' || model.includes('fable')) return 'claude-fable-5'
	if (model.includes('sonnet-5-5') || model.includes('sonnet_5_5')) return 'claude-sonnet-5-5'
	if (model.includes('sonnet-5') || model.includes('sonnet_5')) return 'claude-sonnet-5'
	if (model.includes('sonnet') && (model.includes('4-6') || model.includes('4_6'))) return 'claude-sonnet-4-6'
	if (model.includes('sonnet')) return 'claude-sonnet-5'
	if (model.includes('opus-5-5') || model.includes('opus_5_5')) return 'claude-opus-5-5'
	if (model.includes('opus-5') || model.includes('opus_5')) return 'claude-opus-5'
	if (model.includes('4-8') || model.includes('4_8')) return 'claude-opus-4-8'
	if (model.includes('4-7') || model.includes('4_7')) return 'claude-opus-4-7'
	if (model.includes('4-6') || model.includes('4_6')) {
		return model.includes('[1m]') || model.includes('-1m') ? 'claude-opus-4-6-1m' : 'claude-opus-4-6'
	}
	if (model.includes('4-5') || model.includes('4_5')) return 'claude-opus-4-5'
	if (model.includes('opus')) return 'opus'
	return model
}

/**
 * Returns the default effort/reasoning level for the given agent/provider/model,
 * or `undefined` if the model doesn't support effort selection.
 */
export function getDefaultEffort(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
	model: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): EffortLevel | undefined {
	const cap = getEffortCapability(agent, provider, model, catalogEntry)
	if (!cap.supported) return undefined
	const catalogDefault = catalogEntry?.defaultEffort as EffortLevel | undefined
	if (catalogDefault && cap.levels.includes(catalogDefault)) return catalogDefault
	if (agent === 'claude') {
		return cap.levels.includes(DEFAULT_CLAUDE_EFFORT) ? DEFAULT_CLAUDE_EFFORT : cap.levels[cap.levels.length - 1]
	}
	if (agent === 'codelayer' && provider === 'codex') {
		return cap.levels.includes(DEFAULT_CODEX_REASONING)
			? DEFAULT_CODEX_REASONING
			: cap.levels[cap.levels.length - 1]
	}
	if (agent === 'fold' && (provider === 'codex' || provider === 'xai')) {
		return cap.levels.includes(DEFAULT_CODEX_REASONING)
			? DEFAULT_CODEX_REASONING
			: cap.levels[cap.levels.length - 1]
	}
	if (agent === 'codelayer' && provider === 'anthropic') {
		return cap.levels.includes(DEFAULT_CLAUDE_EFFORT) ? DEFAULT_CLAUDE_EFFORT : cap.levels[cap.levels.length - 1]
	}
	return undefined
}

/** Whether a model supports effort selection and, if so, the levels available. */
export type EffortCapability = { supported: false } | { supported: true; levels: EffortLevel[] }

/**
 * Resolves the effort/reasoning capability for the given agent/provider/model,
 * including the list of supported levels when applicable.
 */
export function getEffortCapability(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
	model: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): EffortCapability {
	if (!model) return { supported: false }
	if (catalogEntry) {
		const levels = catalogEntry.effortLevels as EffortLevel[]
		return levels.length > 0 ? { supported: true, levels } : { supported: false }
	}
	if (agent === 'claude') {
		const levels = claudeEffortLevels(normalizeClaudeModel(model))
		return levels ? { supported: true, levels } : { supported: false }
	}
	if (agent === 'codelayer' && provider === 'codex') {
		const levels = codexReasoningLevels(model, CodexReasoningModel, CODEX_REASONING_LEVELS_BY_MODEL)
		return levels ? { supported: true, levels } : { supported: false }
	}
	if (agent === 'fold' && provider === 'codex') {
		const levels = codexReasoningLevels(model, FoldCodexReasoningModel, FOLD_CODEX_REASONING_LEVELS_BY_MODEL)
		return levels ? { supported: true, levels } : { supported: false }
	}
	if (agent === 'fold' && provider === 'xai') {
		const levels = foldXaiReasoningLevels(model)
		return levels ? { supported: true, levels } : { supported: false }
	}
	if (agent === 'codelayer' && provider === 'anthropic') {
		const levels = codelayerAnthropicEffortLevels(normalizeClaudeModel(model))
		return levels ? { supported: true, levels } : { supported: false }
	}
	return { supported: false }
}

/** Resolves whether Fast Mode is supported for the given agent/provider/model. */
export function getFastModeCapability(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
	model: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): { supported: boolean } {
	if (!model) return { supported: false }
	// Fast Mode for Claude is disabled for now; only Codex models are eligible.
	if (agent === 'claude') return { supported: false }
	if (FAST_MODE_WITHHELD_CODEX_MODELS.has(model)) return { supported: false }
	if (catalogEntry) return { supported: catalogEntry.supportsFastMode }
	if (agent === 'codelayer' && provider === 'codex') return { supported: FAST_MODE_ELIGIBLE_CODEX_MODELS.has(model) }
	return { supported: false }
}

/**
 * Validates an effort value against the model's capability.
 * A nullish effort is always considered valid (treated as "no selection").
 */
export function isEffortSupported(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
	model: string | null | undefined,
	effort: string | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): boolean {
	if (effort == null) return true
	const cap = getEffortCapability(agent, provider, model, catalogEntry)
	return cap.supported && cap.levels.some((level) => level === effort)
}

/**
 * Validates a Fast Mode value against the model's capability.
 * A nullish or `false` value is always considered valid (Fast Mode off).
 */
export function isFastModeSupported(
	agent: CodingAgent | null | undefined,
	provider: string | null | undefined,
	model: string | null | undefined,
	fastMode: boolean | null | undefined,
	catalogEntry?: HostModelCatalogEntry | null,
): boolean {
	if (fastMode == null || fastMode === false) return true
	return getFastModeCapability(agent, provider, model, catalogEntry).supported
}

/** Returns a friendly provider label for known CodeLayer missing-auth errors, or null. */
export function matchCodelayerAuthError(errorMessage: string | null | undefined): string | null {
	if (!errorMessage) return null
	const provider = errorMessage.match(CODELAYER_AUTH_ERROR_PATTERN)?.[1]?.toLowerCase()
	if (!provider) return null
	return Option.match(Schema.decodeUnknownOption(CodelayerAuthErrorProvider)(provider), {
		onNone: () => null,
		onSome: (knownProvider) => CODELAYER_AUTH_ERROR_PROVIDER_LABELS[knownProvider],
	})
}
