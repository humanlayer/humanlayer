/**
 * AgentConfigSection.tsx
 *
 * Section component for agent, provider, model, effort, and fast mode settings.
 * Subscribes to form and store state directly using Zustand selectors.
 *
 * Internalizes:
 * - Settings from settingsStore (default models/provider)
 * - Capability computation via getEffortCapability/getFastModeCapability
 * - Model defaults via getDefaultModelForProvider
 * - Effort/fast mode defaults via getDefaultSessionEffort/getDefaultSessionFastMode
 *
 * Props that must be passed in:
 * - onFastModeToggle: Fast mode warning dialog is rendered at parent level
 */

import { SelectableModelProviderZodSchema } from '@humanlayer/schemas/model-provider'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import { Field, FieldLabel } from '@humanlayer/ui/components/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { AGENT_LABELS, AGENT_OPTIONS } from '@humanlayer/ui/constants/agents'
import { getVisibleProviderOptions, PROVIDER_LABELS } from '@humanlayer/ui/constants/providers'
import { cn } from '@humanlayer/ui/lib/utils'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useWatch } from 'react-hook-form'

import { useHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { type AgentType, type ModelType, type ProviderType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useCodingAgentSetupHost } from '@/hooks/use-coding-agent-setup-host'
import {
	getDefaultModelForProvider,
	getDefaultSessionEffort,
	getDefaultSessionFastMode,
	getLaunchConfigurationForCodingAgent,
} from '@/lib/auto-advance'

import type { Workflow } from './shared'

// --- EffortField component ---

type EffortCapability = { supported: false } | { supported: true; levels: string[] }

const EffortField: FC<{
	effort?: string
	onEffortChange: (value: string) => void
	effortCapability: EffortCapability
	disabled?: boolean
}> = ({ effort, onEffortChange, effortCapability, disabled }) => {
	if (!effortCapability.supported) return null
	return (
		<Field>
			<FieldLabel>Effort</FieldLabel>
			<Select value={effort ?? ''} onValueChange={onEffortChange}>
				<SelectTrigger disabled={disabled} className="uppercase">
					<SelectValue placeholder="Select effort" />
				</SelectTrigger>
				<SelectContent>
					{effortCapability.levels.map((level) => (
						<SelectItem key={level} value={level} className="uppercase">
							{level}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	)
}

// --- Main section component ---

export interface AgentConfigSectionProps {
	/** The daemon host that will run the initial session. Setup acknowledgements are host-scoped. */
	hostId: string
	// Fast mode toggle callback (needs parent coordination for warning dialog)
	onFastModeToggle: (value: boolean) => void
}

/**
 * AgentConfigSection renders agent, provider, model, effort, and fast mode controls.
 *
 * Internalizes most state from stores, but requires onFastModeToggle callback
 * because the warning dialog is rendered at the parent level.
 */
export const AgentConfigSection: FC<AgentConfigSectionProps> = ({ hostId, onFastModeToggle }) => {
	const form = useNewTaskFormStore((s) => s.form)
	const submitState = useNewTaskFormStore((s) => s.submitState)

	// Settings from settingsStore
	const defaultClaudeCodeModel = useSettingsStore((s) => s.defaultClaudeCodeModel)
	const defaultCodelayerProvider = useSettingsStore((s) => s.defaultCodelayerProvider)
	const defaultCodelayerAnthropicModel = useSettingsStore((s) => s.defaultCodelayerAnthropicModel)
	const defaultCodelayerCopilotModel = useSettingsStore((s) => s.defaultCodelayerCopilotModel)
	const defaultCodelayerCodexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const defaultCodelayerXaiModel = useSettingsStore((s) => s.defaultCodelayerXaiModel)
	const defaultCodelayerFirepassModel = useSettingsStore((s) => s.defaultCodelayerFirepassModel)
	const defaultClaudeCodeEffort = useSettingsStore((s) => s.defaultClaudeCodeEffort)
	const defaultCodelayerAnthropicEffort = useSettingsStore((s) => s.defaultCodelayerAnthropicEffort)
	const defaultCodelayerCodexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const defaultClaudeCodeFastMode = useSettingsStore((s) => s.defaultClaudeCodeFastMode)
	const defaultCodelayerCodexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const setupHost = useCodingAgentSetupHost(hostId)
	const models = useHostModelRegistry(hostId)
	const { guardSetup } = useCodingAgentSetupGuard()

	const workflow = useWatch({ control: form?.control, name: 'workflow' }) as Workflow | undefined
	const codingAgent = useWatch({ control: form?.control, name: 'codingAgent' }) as AgentType | undefined
	const provider = useWatch({ control: form?.control, name: 'provider' })
	const model = useWatch({ control: form?.control, name: 'model' })
	const effort = useWatch({ control: form?.control, name: 'effort' })
	const fastMode = useWatch({ control: form?.control, name: 'fastMode' })

	const isSubmitting = submitState.isSubmitting

	// Helper to get default model for a provider
	const getDefaultModel = useCallback(
		(agent: AgentType, prov: ProviderType): ModelType => {
			if (agent === 'claude') return defaultClaudeCodeModel
			return getDefaultModelForProvider({
				provider: prov,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
			})
		},
		[
			defaultClaudeCodeModel,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerCodexModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
		],
	)

	const effectiveCodingAgent = useFoldCodingAgent && codingAgent === 'codelayer' ? 'fold' : codingAgent
	const filteredModels = useMemo(
		() => models.optionsFor({ agent: effectiveCodingAgent, provider }),
		[models, effectiveCodingAgent, provider],
	)
	const modelIsSelectable = filteredModels.some((option) => option.value === model)
	const selectedModel = modelIsSelectable
		? model
		: effectiveCodingAgent && provider
			? getDefaultModel(effectiveCodingAgent, provider)
			: model

	const selectedModelCapabilities = useMemo(
		() => models.capabilitiesOf({ agent: effectiveCodingAgent, provider, model: selectedModel }),
		[models, effectiveCodingAgent, provider, selectedModel],
	)
	const effortCapability = selectedModelCapabilities.effort
	const fastModeCapability = selectedModelCapabilities.fastMode

	// Helper to get default effort for agent/provider/model
	const getLaunchEffort = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) =>
			getDefaultSessionEffort({
				codingAgent: agent,
				provider: prov,
				model: mod,
				defaultClaudeCodeEffort,
				defaultCodelayerAnthropicEffort,
				defaultCodelayerCodexEffort,
				models,
			}),
		[defaultClaudeCodeEffort, defaultCodelayerAnthropicEffort, defaultCodelayerCodexEffort, models],
	)

	// Helper to get default fast mode for agent/provider/model
	const getLaunchFastMode = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) =>
			getDefaultSessionFastMode({
				codingAgent: agent,
				provider: prov,
				model: mod,
				defaultClaudeCodeFastMode,
				defaultCodelayerCodexFastMode,
				models,
			}),
		[defaultClaudeCodeFastMode, defaultCodelayerCodexFastMode, models],
	)

	const applyAgentDefaults = useCallback(
		(agent: AgentType, prov: ProviderType, mod: string) => {
			form?.setValue('effort', getLaunchEffort(agent, prov, mod), { shouldDirty: true, shouldValidate: true })
			form?.setValue('fastMode', getLaunchFastMode(agent, prov, mod), {
				shouldDirty: true,
				shouldValidate: true,
			})
		},
		[form, getLaunchEffort, getLaunchFastMode],
	)

	const selectedEffort = useMemo(() => {
		if (!effortCapability.supported || !effectiveCodingAgent || !provider || !selectedModel) return undefined
		if (effort && (effortCapability.levels as string[]).includes(effort)) return effort
		return getLaunchEffort(effectiveCodingAgent, provider, selectedModel)
	}, [effectiveCodingAgent, provider, selectedModel, effort, effortCapability, getLaunchEffort])
	const selectedFastMode =
		fastModeCapability.supported && effectiveCodingAgent && provider && selectedModel
			? (fastMode ?? getLaunchFastMode(effectiveCodingAgent, provider, selectedModel) ?? false)
			: (fastMode ?? false)

	const handleCodingAgentChange = useCallback(
		(value: AgentType) => {
			if (!form) return
			const launchConfig = getLaunchConfigurationForCodingAgent({
				codingAgent: value,
				defaultClaudeCodeModel,
				defaultCodelayerProvider,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
				useFoldCodingAgent,
			})
			form.setValue('codingAgent', value)
			form.setValue('provider', launchConfig.provider)
			form.setValue('model', launchConfig.model)
			applyAgentDefaults(value, launchConfig.provider, launchConfig.model)
		},
		[
			form,
			defaultClaudeCodeModel,
			defaultCodelayerProvider,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerCodexModel,
			defaultCodelayerXaiModel,
			defaultCodelayerFirepassModel,
			useFoldCodingAgent,
			applyAgentDefaults,
		],
	)
	const handleGuardedCodingAgentChange = useCallback(
		(value: AgentType) => {
			const launchConfig = getLaunchConfigurationForCodingAgent({
				codingAgent: value,
				defaultClaudeCodeModel,
				defaultCodelayerProvider,
				defaultCodelayerAnthropicModel,
				defaultCodelayerCopilotModel,
				defaultCodelayerCodexModel,
				defaultCodelayerXaiModel,
				defaultCodelayerFirepassModel,
				useFoldCodingAgent,
			})
			if (value === 'codelayer' || value === 'fold') {
				guardSetup({
					agent: value,
					provider: launchConfig.provider,
					host: setupHost,
					onContinue: () => handleCodingAgentChange(value),
				})
				return
			}
			handleCodingAgentChange(value)
		},
		[
			defaultClaudeCodeModel,
			defaultCodelayerAnthropicModel,
			defaultCodelayerCodexModel,
			defaultCodelayerCopilotModel,
			defaultCodelayerFirepassModel,
			defaultCodelayerProvider,
			defaultCodelayerXaiModel,
			guardSetup,
			handleCodingAgentChange,
			setupHost,
			useFoldCodingAgent,
		],
	)

	const handleModelChange = useCallback(
		(value: string) => {
			if (!form) return
			const agent = form.getValues('codingAgent') as AgentType
			const prov = form.getValues('provider')
			form.setValue('model', value)
			applyAgentDefaults(agent, prov, value)
		},
		[form, applyAgentDefaults],
	)
	const handleProviderChange = useCallback(
		(value: string) => {
			if (!form) return
			const nextProvider = SelectableModelProviderZodSchema.parse(value)
			const nextAgent = useFoldCodingAgent ? 'fold' : 'codelayer'
			guardSetup({
				agent: nextAgent,
				provider: nextProvider,
				host: setupHost,
				onContinue: () => {
					const nextModel = getDefaultModel(nextAgent, nextProvider)
					form.setValue('codingAgent', nextAgent)
					form.setValue('provider', nextProvider)
					form.setValue('model', nextModel)
					applyAgentDefaults(nextAgent, nextProvider, nextModel)
				},
			})
		},
		[applyAgentDefaults, form, getDefaultModel, guardSetup, setupHost, useFoldCodingAgent],
	)

	const handleEffortChange = useCallback(
		(value: string) => {
			form?.setValue('effort', value, { shouldDirty: true })
		},
		[form],
	)

	if (!form) return null

	// Only show for guided workflows
	const showAgentConfig =
		workflow === 'rpi' || workflow === 'outline_only' || workflow === 'prd_tdd' || workflow === 'oneshot'
	if (!showAgentConfig) return null

	const agentSelect = (
		<Field>
			<FieldLabel>Coding Agent</FieldLabel>
			<Select
				value={effectiveCodingAgent}
				onValueChange={(value) => handleGuardedCodingAgentChange(value as AgentType)}
			>
				<SelectTrigger disabled={isSubmitting}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(useFoldCodingAgent
						? AGENT_OPTIONS.map((option) =>
								option.value === 'codelayer' ? { value: 'fold' as const, label: 'Fold' } : option,
							)
						: AGENT_OPTIONS
					).map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{AGENT_LABELS[option.value]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	)

	const modelSelect = (
		<Field>
			<FieldLabel>Model</FieldLabel>
			<Select value={selectedModel} onValueChange={handleModelChange}>
				<SelectTrigger disabled={isSubmitting}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{filteredModels.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	)
	const providerSelect =
		useFoldCodingAgent && effectiveCodingAgent === 'fold' ? (
			<Field>
				<FieldLabel>Provider</FieldLabel>
				<Select value={provider} onValueChange={handleProviderChange}>
					<SelectTrigger disabled={isSubmitting}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{getVisibleProviderOptions(true).map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{PROVIDER_LABELS[option.value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
		) : null

	// Claude Code: single row [Coding Agent] [Model] [Effort?]. Fast Mode is never shown.
	if (codingAgent === 'claude') {
		return (
			<div className={cn('grid gap-4', effortCapability.supported ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
				{agentSelect}
				{modelSelect}
				<EffortField
					effort={selectedEffort}
					onEffortChange={handleEffortChange}
					effortCapability={effortCapability}
					disabled={isSubmitting}
				/>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<div className={cn('grid gap-4', providerSelect ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
				{agentSelect}
				{providerSelect}
				{modelSelect}
			</div>
			{(effortCapability.supported || fastModeCapability.supported) && (
				<div className="grid gap-4 md:grid-cols-2">
					<div className="md:col-start-2">
						<div className="flex items-end gap-2">
							{effortCapability.supported && (
								<div className="flex-1 min-w-0">
									<EffortField
										effort={selectedEffort}
										onEffortChange={handleEffortChange}
										effortCapability={effortCapability}
										disabled={isSubmitting}
									/>
								</div>
							)}
							{fastModeCapability.supported && (
								<FastModeToggle
									enabled={selectedFastMode}
									onToggle={onFastModeToggle}
									disabled={isSubmitting}
									className="h-9 px-3"
								/>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
