import type { PermissionsMode, Session } from '@humanlayer/db/tables/sessions'

import { createModelRegistry } from '@/lib/model-registry'
import type { HostRow } from '@/minimalist/lib/data'

/** The coding agents this UI launches. Picking a model picks its agent. */
export type Agent = 'claude' | 'codelayer'

export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codelayer: 'Codex' }
export const AGENT_PROVIDERS = { claude: 'anthropic', codelayer: 'codex' } as const satisfies Record<Agent, string>

/** Run on the host to sign it in to Codex, as the standard setup dialog instructs. */
export const CODEX_SIGN_IN = 'humanlayer agents auth codex login'

export type ModelOption = {
	agent: Agent
	value: string
	label: string
	efforts: string[]
	defaultEffort: string | null
	/** Codex models that can run on the priority tier. */
	fastMode: boolean
	/** Claude models that can use the Auto permission mode. */
	autoMode: boolean
}

export type ComposerSettings = {
	agent: Agent
	model: string
	effort: string | null
	fastMode: boolean
	permissionsMode: PermissionsMode
}

export type ModelCatalog = {
	models: ModelOption[]
	/** The host reported missing or rejected Codex credentials, not just a failed model probe. */
	codexSignedOut: boolean
}

/**
 * The standard UI's bundled models and host additions, with the same capability rules.
 * A missing, empty or failed probe does not remove an agent's bundled models.
 */
export function modelCatalog(host: Pick<HostRow, 'supported_models'> | null | undefined): ModelCatalog {
	const catalog = host?.supported_models ?? null
	const registry = createModelRegistry(catalog)
	const agents: Agent[] = ['claude', 'codelayer']
	return {
		models: agents.flatMap((agent) => {
			const provider = AGENT_PROVIDERS[agent]
			return registry.optionsFor({ agent, provider }).map((option) => {
				const capabilities = registry.capabilitiesOf({ agent, provider, model: option.value })
				return {
					agent,
					value: option.value,
					label: titleCase(option.label),
					efforts: capabilities.effort.supported ? capabilities.effort.levels : [],
					defaultEffort: capabilities.defaultEffort ?? null,
					fastMode: capabilities.fastMode.supported,
					autoMode: agent === 'claude' && capabilities.autoMode.supported,
				}
			})
		}),
		codexSignedOut:
			catalog?.codex.status === 'unavailable' &&
			(catalog.codex.reason === 'not_logged_in' || catalog.codex.reason === 'unauthorized'),
	}
}

/** Bundled labels shout ("OPUS 4.8") while host labels don't ("Opus 5.5"); words in capitals read as title case. Acronyms like GPT keep theirs. */
export function titleCase(label: string): string {
	return label.replace(/\b[A-Z]{4,}\b/g, (word) => word[0] + word.slice(1).toLowerCase())
}

/** The agent a session runs; sessions from agents this UI doesn't launch read as Claude Code. */
export function agentOf(codingAgent: string): Agent {
	return codingAgent === 'codelayer' ? 'codelayer' : 'claude'
}

/** What the composer shows for a running session. */
export function sessionSettings(
	session: Pick<Session, 'coding_agent' | 'model' | 'effort' | 'fast_mode' | 'permissions_mode'>,
): ComposerSettings {
	const agent = agentOf(session.coding_agent)
	return {
		agent,
		model: session.model ?? (agent === 'claude' ? 'opus' : ''),
		effort: session.effort ?? null,
		fastMode: session.fast_mode,
		permissionsMode: session.permissions_mode as PermissionsMode,
	}
}

/**
 * Settings after picking `model`: keep the effort if it offers it, keep fast mode if it runs
 * it, and move permissions to what the agent allows. Codex always runs without asking;
 * leaving it, or picking a model without Auto, falls back to the safest mode that fits.
 */
export function pickModel(settings: ComposerSettings, model: ModelOption): ComposerSettings {
	let permissionsMode = settings.permissionsMode
	if (model.agent === 'codelayer') permissionsMode = 'bypass'
	else if (settings.agent === 'codelayer') permissionsMode = model.autoMode ? 'auto' : 'default'
	if (permissionsMode === 'auto' && !model.autoMode) permissionsMode = 'default'
	return {
		agent: model.agent,
		model: model.value,
		effort: effortFor(model, settings.effort),
		fastMode: model.fastMode && settings.fastMode,
		permissionsMode,
	}
}

/**
 * Fit saved settings within the chosen agent. Catalog reports must not switch agents.
 */
export function fitSettings(settings: ComposerSettings, catalog: ModelCatalog): ComposerSettings {
	const own = catalog.models.filter((model) => model.agent === settings.agent)
	const model = own.find((option) => option.value === settings.model) ?? own[0]
	return model ? pickModel(settings, model) : settings
}

const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' } as const

export function effortLabel(effort: string | null | undefined): string {
	if (!effort) return ''
	return effort in EFFORT_LABELS ? EFFORT_LABELS[effort as keyof typeof EFFORT_LABELS] : effort
}

export function modelLabel(models: ModelOption[], value: string | null | undefined): string {
	if (!value) return 'Default model'
	return models.find((model) => model.value === value)?.label ?? value
}

/** The effort to keep when switching to `model`: the current one if the model offers it, else its default. */
export function effortFor(model: ModelOption, effort: string | null): string | null {
	return effort && model.efforts.includes(effort) ? effort : model.defaultEffort
}

/** The latest model of each line. Everything else waits behind "More models". */
const FEATURED_MODELS = new Set([
	'fable-5-1',
	'opus-5-5',
	'sonnet-5-5',
	'haiku-5-5',
	'gpt-6-1-sol',
	'gpt-6-1-luna',
	'gpt-6-astra',
])

/** "claude-opus-5-5", "Opus 5.5" and "GPT-6.1-Sol" all reduce to the same kind of key. */
function modelKey(text: string): string {
	return text
		.toLowerCase()
		.replace(/^claude-/, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}

/**
 * One agent's models split into the latest ones and the rest. The selected model always stays
 * in view, and an agent with none of the latest models shows everything.
 */
export function splitModels(
	models: ModelOption[],
	selected: string | null | undefined,
): { featured: ModelOption[]; more: ModelOption[] } {
	const isFeatured = (model: ModelOption) =>
		FEATURED_MODELS.has(modelKey(model.value)) || FEATURED_MODELS.has(modelKey(model.label))
	if (!models.some(isFeatured)) return { featured: models, more: [] }
	return {
		featured: models.filter((model) => isFeatured(model) || model.value === selected),
		more: models.filter((model) => !isFeatured(model) && model.value !== selected),
	}
}
