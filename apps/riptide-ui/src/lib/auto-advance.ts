import type { FoldModelProvider } from '@humanlayer/schemas/model-provider'
import { MODEL_OPTIONS, type XaiModelOption } from '@humanlayer/ui/constants/models'

import type { AgentType, ModelType, ProviderType } from '@/hooks/stores/settingsStore'
import { BUNDLED_MODEL_REGISTRY, type ModelRegistry } from '@/lib/model-registry'

export interface LaunchConfiguration {
	codingAgent: AgentType
	provider: ProviderType
	model: ModelType
}

interface LaunchConfigurationDefaults {
	defaultClaudeCodeModel: ModelType
	defaultCodelayerProvider: ProviderType
	defaultCodelayerAnthropicModel: ModelType
	defaultCodelayerCopilotModel: ModelType
	defaultCodelayerCodexModel: ModelType
	defaultCodelayerXaiModel: XaiModelOption
	defaultCodelayerFirepassModel: ModelType
	useFoldCodingAgent: boolean
}

export interface LaunchEffortDefaults {
	defaultClaudeCodeEffort?: string
	defaultCodelayerAnthropicEffort?: string
	defaultCodelayerCodexEffort?: string
}

export type FirstSessionWorkflow = 'rpi' | 'oneshot'

/**
 * Added to a small task's prompt and task.md, so the agent ends with the describe-pr skill in a
 * code block. Next-step extraction picks that up, with or without auto-advance. It only reads a
 * fenced block, so the agent gets the exact section to copy: asked to "offer" the skill, it names
 * it inline and extraction finds nothing.
 */
export const DESCRIBE_PR_NEXT_STEP_PROMPT =
	'When the change is done and you are confident in it, end your final answer with this section, ' +
	'copied exactly, code block included:\n\n' +
	'### Next steps\n\n' +
	'To create a PR, use the button below, or create a new session with the following command:\n\n' +
	'```\n/rpi:describe-pr\n```'

export function withDescribePrNextStep(text: string): string {
	return text ? `${text}\n\n${DESCRIBE_PR_NEXT_STEP_PROMPT}` : DESCRIBE_PR_NEXT_STEP_PROMPT
}

/**
 * Returns the first session parameters for an auto-advance task.
 */
export function getFirstSessionParams(task: {
	slug: string | null
	name: string
	autoAdvanceQuestionsToResearch: boolean
	workflow?: FirstSessionWorkflow
}): {
	title: string
	prompt: string
	permissionsMode: 'bypass' | 'default'
} {
	const identifier = task.slug || task.name
	if (task.workflow === 'oneshot') {
		return {
			title: `implement-plan: Implement ${identifier}`,
			prompt:
				`use the rpi:implement-plan skill (no subagent) for .humanlayer/tasks/${identifier}; ` +
				`there's no plan, just implement the ticket.md, and then read the final answer template reference from the implement plan skill's directory, and reproduce the final answer from that reference exactly as indicated.`,
			permissionsMode: 'bypass',
		}
	}

	return {
		title: `research-questions: Research questions for ${identifier}`,
		prompt: `use the rpi:create-research-questions skill for .humanlayer/tasks/${identifier}`,
		permissionsMode: task.autoAdvanceQuestionsToResearch ? 'bypass' : 'default',
	}
}

export function getDefaultLaunchConfiguration({
	defaultAgent,
	defaultClaudeCodeModel,
	defaultCodelayerProvider,
	defaultCodelayerAnthropicModel,
	defaultCodelayerCopilotModel,
	defaultCodelayerCodexModel,
	defaultCodelayerXaiModel,
	defaultCodelayerFirepassModel,
	useFoldCodingAgent,
}: {
	defaultAgent: AgentType
} & LaunchConfigurationDefaults): LaunchConfiguration {
	return getLaunchConfigurationForCodingAgent({
		codingAgent: useFoldCodingAgent && defaultAgent === 'codelayer' ? 'fold' : defaultAgent,
		defaultClaudeCodeModel,
		defaultCodelayerProvider,
		defaultCodelayerAnthropicModel,
		defaultCodelayerCopilotModel,
		defaultCodelayerCodexModel,
		defaultCodelayerXaiModel,
		defaultCodelayerFirepassModel,
		useFoldCodingAgent,
	})
}

export function getLaunchConfigurationForCodingAgent({
	codingAgent,
	defaultClaudeCodeModel,
	defaultCodelayerProvider,
	defaultCodelayerAnthropicModel,
	defaultCodelayerCopilotModel,
	defaultCodelayerCodexModel,
	defaultCodelayerXaiModel,
	defaultCodelayerFirepassModel,
	useFoldCodingAgent,
}: {
	codingAgent: AgentType
} & LaunchConfigurationDefaults): LaunchConfiguration {
	const provider =
		codingAgent === 'claude'
			? 'anthropic'
			: getCodelayerProviderForLaunch(defaultCodelayerProvider, useFoldCodingAgent)
	const model =
		codingAgent === 'claude'
			? defaultClaudeCodeModel
			: getDefaultModelForProvider({
					provider,
					defaultCodelayerAnthropicModel,
					defaultCodelayerCopilotModel,
					defaultCodelayerCodexModel,
					defaultCodelayerXaiModel,
					defaultCodelayerFirepassModel,
				})

	return { codingAgent, provider, model }
}

export function getCodelayerProviderForLaunch(provider: ProviderType, useFoldCodingAgent: boolean): FoldModelProvider {
	return useFoldCodingAgent && provider === 'xai' ? 'xai' : 'codex'
}

export function getDefaultSessionEffort({
	codingAgent,
	provider,
	model,
	defaultClaudeCodeEffort,
	defaultCodelayerAnthropicEffort,
	defaultCodelayerCodexEffort,
	models = BUNDLED_MODEL_REGISTRY,
}: {
	codingAgent: AgentType
	provider: ProviderType
	model: string
	models?: ModelRegistry
} & LaunchEffortDefaults): string | undefined {
	const capabilities = models.capabilitiesOf({ agent: codingAgent, provider, model })
	const capability = capabilities.effort
	if (!capability.supported) return undefined

	let configuredDefault: string | undefined
	if (codingAgent === 'claude') configuredDefault = defaultClaudeCodeEffort
	else if (codingAgent === 'codelayer' && provider === 'anthropic') {
		configuredDefault = defaultCodelayerAnthropicEffort
	} else if (codingAgent === 'codelayer' && provider === 'codex') {
		configuredDefault = defaultCodelayerCodexEffort
	}

	if (configuredDefault && (capability.levels as string[]).includes(configuredDefault)) {
		return configuredDefault
	}

	return capabilities.defaultEffort
}

export function getDefaultSessionFastMode({
	codingAgent,
	provider,
	model,
	defaultClaudeCodeFastMode,
	defaultCodelayerCodexFastMode,
	models = BUNDLED_MODEL_REGISTRY,
}: {
	codingAgent: AgentType
	provider: ProviderType
	model: string
	defaultClaudeCodeFastMode?: boolean
	defaultCodelayerCodexFastMode?: boolean
	models?: ModelRegistry
}): boolean | undefined {
	const capability = models.capabilitiesOf({ agent: codingAgent, provider, model }).fastMode
	if (!capability.supported) return undefined

	if (codingAgent === 'claude') return defaultClaudeCodeFastMode ?? false
	if (codingAgent === 'codelayer' && provider === 'codex') return defaultCodelayerCodexFastMode ?? false
	return undefined
}

export function getDefaultModelForProvider({
	provider,
	defaultCodelayerAnthropicModel,
	defaultCodelayerCopilotModel,
	defaultCodelayerCodexModel,
	defaultCodelayerXaiModel,
	defaultCodelayerFirepassModel,
}: {
	provider: ProviderType
	defaultCodelayerAnthropicModel: ModelType
	defaultCodelayerCopilotModel: ModelType
	defaultCodelayerCodexModel: ModelType
	defaultCodelayerXaiModel: XaiModelOption
	defaultCodelayerFirepassModel: ModelType
}): ModelType {
	const fallbackModel =
		MODEL_OPTIONS.find((option) => option.provider === provider)?.value ?? defaultCodelayerAnthropicModel
	const configuredModel = getConfiguredModelForProvider({
		provider,
		defaultCodelayerAnthropicModel,
		defaultCodelayerCopilotModel,
		defaultCodelayerCodexModel,
		defaultCodelayerXaiModel,
		defaultCodelayerFirepassModel,
	})

	if (MODEL_OPTIONS.some((option) => option.provider === provider && option.value === configuredModel)) {
		return configuredModel
	}

	return fallbackModel
}

export function getConfiguredModelForProvider({
	provider,
	defaultCodelayerAnthropicModel,
	defaultCodelayerCopilotModel,
	defaultCodelayerCodexModel,
	defaultCodelayerXaiModel,
	defaultCodelayerFirepassModel,
}: {
	provider: ProviderType
	defaultCodelayerAnthropicModel: ModelType
	defaultCodelayerCopilotModel: ModelType
	defaultCodelayerCodexModel: ModelType
	defaultCodelayerXaiModel: XaiModelOption
	defaultCodelayerFirepassModel: ModelType
}): ModelType {
	switch (provider) {
		case 'anthropic':
			return defaultCodelayerAnthropicModel
		case 'copilot':
			return defaultCodelayerCopilotModel
		case 'codex':
			return defaultCodelayerCodexModel
		case 'xai':
			return defaultCodelayerXaiModel
		case 'firepass':
			return defaultCodelayerFirepassModel
	}
}
