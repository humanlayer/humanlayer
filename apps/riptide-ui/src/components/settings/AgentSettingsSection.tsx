import {
	type ClaudeEffortLevel,
	type CodexReasoningLevel,
	getDefaultEffort,
	getEffortCapability,
	getFastModeCapability,
} from '@humanlayer/ai/config'
import { SelectableModelProviderZodSchema } from '@humanlayer/schemas/model-provider'
import { Button } from '@humanlayer/ui/components/button'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Switch } from '@humanlayer/ui/components/switch'
import { findXaiModelOption, getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import { getVisibleProviderOptions } from '@humanlayer/ui/constants/providers'
import { getHumanLayerCliNpxCommand } from '@humanlayer/ui/lib/humanlayer-cli'
import { isDefinedError } from '@orpc/client'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { FastModeWarningDialog } from '@/components/FastModeWarningDialog'
import { useAnyHostModelRegistry } from '@/hooks/live-queries/use-model-registry'
import { type AgentType, type ModelType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'
import { buildConfig } from '@/lib/config'
import type { ModelRegistry } from '@/lib/model-registry'
import { AGENT_OPTIONS } from '@/lib/preferences'
import { useRiptideApi } from '@/orpc/client'

const GROK_AUTH_COMMAND = getHumanLayerCliNpxCommand(buildConfig.type, 'fold auth xai login')

// Reconcile a stored effort to a model's capability: when the model doesn't support the current
// effort, fall back to that model's default. Pure (no component state), so it lives at module scope
// and is called from the model-change handlers — an event-driven replacement for the old effects.
function reconcileEffort(
	agent: AgentType,
	model: ModelType,
	currentEffort: ClaudeEffortLevel,
	setEffort: (effort: ClaudeEffortLevel) => void,
	models: ModelRegistry,
) {
	const capabilities = models.capabilitiesOf({ agent, provider: 'anthropic', model })
	if (!capabilities.effort.supported) return
	if ((capabilities.effort.levels as ClaudeEffortLevel[]).includes(currentEffort)) return
	const fallback = capabilities.defaultEffort as ClaudeEffortLevel | undefined
	if (fallback) setEffort(fallback)
}

/** A saved default the host no longer offers still renders in the select instead of a blank trigger. */
function withStoredDefault(
	options: ReadonlyArray<{ readonly value: string; readonly label: string }>,
	stored: string,
	storedLabel: string,
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
	if (!stored || options.some((option) => option.value === stored)) return options
	return [...options, { value: stored, label: storedLabel }]
}

export function AgentSettingsSection() {
	const defaultAgent = useSettingsStore((s) => s.defaultAgent)
	const setDefaultAgent = useSettingsStore((s) => s.setDefaultAgent)
	const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
	const defaultClaudeCodeModel = useSettingsStore((s) => s.defaultClaudeCodeModel)
	const setDefaultClaudeCodeModel = useSettingsStore((s) => s.setDefaultClaudeCodeModel)
	const defaultClaudeCodeEffort = useSettingsStore((s) => s.defaultClaudeCodeEffort)
	const setDefaultClaudeCodeEffort = useSettingsStore((s) => s.setDefaultClaudeCodeEffort)
	const defaultCodelayerCodexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const setDefaultCodelayerCodexModel = useSettingsStore((s) => s.setDefaultCodelayerCodexModel)
	const defaultCodelayerProvider = useSettingsStore((s) => s.defaultCodelayerProvider)
	const setDefaultCodelayerProvider = useSettingsStore((s) => s.setDefaultCodelayerProvider)
	const defaultCodelayerXaiModel = useSettingsStore((s) => s.defaultCodelayerXaiModel)
	const setDefaultCodelayerXaiModel = useSettingsStore((s) => s.setDefaultCodelayerXaiModel)
	const useFoldCodingAgent = useSettingsStore((s) => s.useFoldCodingAgent)
	const defaultCodelayerCodexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const setDefaultCodelayerCodexEffort = useSettingsStore((s) => s.setDefaultCodelayerCodexEffort)
	const defaultCodelayerCodexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)
	const setDefaultCodelayerCodexFastMode = useSettingsStore((s) => s.setDefaultCodelayerCodexFastMode)
	const applyServerSettings = useSettingsStore((s) => s.applyServerSettings)
	const markMutationInFlight = useSettingsStore((s) => s.markMutationInFlight)

	const { queryClient: api } = useRiptideApi()
	const models = useAnyHostModelRegistry()
	const claudeCodeModelOptions = withStoredDefault(
		models.optionsFor({ agent: 'claude', provider: 'anthropic' }),
		defaultClaudeCodeModel,
		models.labelOf({ agent: 'claude', provider: 'anthropic', model: defaultClaudeCodeModel }),
	)
	const codexAgent = useFoldCodingAgent ? 'fold' : 'codelayer'
	const codexModelOptions = withStoredDefault(
		models.optionsFor({ agent: codexAgent, provider: 'codex' }),
		defaultCodelayerCodexModel,
		models.labelOf({ agent: codexAgent, provider: 'codex', model: defaultCodelayerCodexModel }),
	)
	const codexEffortCapability = getEffortCapability(codexAgent, 'codex', defaultCodelayerCodexModel)
	const codexEffortLevels = codexEffortCapability.supported
		? (codexEffortCapability.levels as CodexReasoningLevel[])
		: []
	const selectedCodexEffort = codexEffortLevels.includes(defaultCodelayerCodexEffort)
		? defaultCodelayerCodexEffort
		: getDefaultEffort(codexAgent, 'codex', defaultCodelayerCodexModel)
	const codexFastModeSupported = getFastModeCapability(codexAgent, 'codex', defaultCodelayerCodexModel).supported
	const handleDefaultCodexModelChange = (value: string) => {
		const model = value as ModelType
		setDefaultCodelayerCodexModel(model)
		const capability = getEffortCapability(codexAgent, 'codex', model)
		if (!capability.supported || capability.levels.includes(defaultCodelayerCodexEffort)) return
		const fallback = getDefaultEffort(codexAgent, 'codex', model)
		if (fallback) setDefaultCodelayerCodexEffort(fallback)
	}

	const codelayerXaiModelOptions = getModelOptionsForAgentProvider({ agent: 'fold', provider: 'xai' })
	const handleDefaultXaiModelChange = (value: string) => {
		const model = findXaiModelOption(value)
		if (model) setDefaultCodelayerXaiModel(model)
	}

	const updateSettingsMutation = useMutation(
		api.auth.user.settings.update.mutationOptions({
			onSuccess: (data) => {
				// Reset the guard before applying so the authoritative response is fully applied
				useSettingsStore.setState({ _lastMutationAt: 0 })
				applyServerSettings(data)
			},
			onError: (error) => {
				useSettingsStore.setState({ _lastMutationAt: 0 })
				if (isDefinedError(error) && error.code === 'FEATURE_DISABLED_BY_ORG') {
					toast.error('Feature disabled by organization')
				}
			},
		}),
	)
	type UpdateSettingsInput = Parameters<typeof updateSettingsMutation.mutate>[0]

	const mutateUserSettings = useCallback(
		(input: UpdateSettingsInput) => {
			updateSettingsMutation.mutate(input)
		},
		[updateSettingsMutation],
	)

	const handleModelChange = (model: string) => {
		const typedModel = model as ModelType
		setDefaultModel(typedModel)
		markMutationInFlight()
		mutateUserSettings({
			defaultModel: model as NonNullable<UpdateSettingsInput['defaultModel']>,
		})
	}

	const handleClaudeCodeModelChange = (value: string) => {
		const model = value as ModelType
		setDefaultClaudeCodeModel(model)
		// Also update legacy defaultModel for server sync
		handleModelChange(value)
		reconcileEffort('claude', model, defaultClaudeCodeEffort, setDefaultClaudeCodeEffort, models)
	}

	const {
		onToggle: handleDefaultCodelayerCodexFastModeChange,
		pendingEnable: defaultCodelayerCodexFastModePendingEnable,
		setPendingEnable: setDefaultCodelayerCodexFastModePendingEnable,
		confirm: confirmDefaultCodelayerCodexFastMode,
	} = useFastModeToggleGuard(setDefaultCodelayerCodexFastMode)

	const defaultClaudeCodeCapabilities = models.capabilitiesOf({
		agent: 'claude',
		provider: 'anthropic',
		model: defaultClaudeCodeModel,
	})
	const defaultClaudeCodeEffortCapability = defaultClaudeCodeCapabilities.effort
	const defaultClaudeCodeEffortLevels = defaultClaudeCodeEffortCapability.supported
		? (defaultClaudeCodeEffortCapability.levels as ClaudeEffortLevel[])
		: []
	const defaultClaudeCodeFallbackEffort = defaultClaudeCodeCapabilities.defaultEffort as ClaudeEffortLevel | undefined
	const selectedDefaultClaudeCodeEffort = defaultClaudeCodeEffortLevels.includes(defaultClaudeCodeEffort)
		? defaultClaudeCodeEffort
		: defaultClaudeCodeFallbackEffort
	return (
		<>
			<div className="space-y-8">
				{/* Default Coding Agent */}
				<div className="space-y-2">
					<Label htmlFor="default-agent">Default Coding Agent</Label>
					<Select
						value={defaultAgent}
						onValueChange={(value) => {
							markMutationInFlight()
							setDefaultAgent(value as AgentType)
							mutateUserSettings({ defaultAgent: value as AgentType })
						}}
					>
						<SelectTrigger id="default-agent" className="w-[200px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AGENT_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{useFoldCodingAgent && option.value === 'codelayer' ? 'Fold' : option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						Choose which coding agent to use by default for new sessions.
					</p>
				</div>

				{/* Claude Code Settings */}
				<section className="space-y-3 p-4 rounded-lg border border-border/50 bg-muted/30">
					<h3 className="text-sm font-semibold">Claude Code</h3>
					<div className="flex items-center gap-4">
						<Label htmlFor="claude-code-model" className="w-28 shrink-0 text-sm text-muted-foreground">
							Default Model
						</Label>
						<Select value={defaultClaudeCodeModel} onValueChange={handleClaudeCodeModelChange}>
							<SelectTrigger id="claude-code-model" className="w-[180px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{claudeCodeModelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value} className="uppercase">
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="flex items-center gap-4">
						<Label htmlFor="claude-code-effort" className="w-28 shrink-0 text-sm text-muted-foreground">
							Default Effort
						</Label>
						{defaultClaudeCodeEffortCapability.supported ? (
							<Select
								value={selectedDefaultClaudeCodeEffort}
								onValueChange={(value) => setDefaultClaudeCodeEffort(value as ClaudeEffortLevel)}
							>
								<SelectTrigger id="claude-code-effort" className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{defaultClaudeCodeEffortLevels.map((level) => (
										<SelectItem key={level} value={level}>
											{level}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Button variant="outline" disabled className="w-[180px] justify-start font-normal">
								Not supported
							</Button>
						)}
					</div>
				</section>

				{useFoldCodingAgent && (
					<section className="space-y-4 p-4 rounded-lg border border-border/50 bg-muted/30">
						<h3 className="text-sm font-semibold">Fold Providers</h3>
						<div className="flex items-center gap-4">
							<Label htmlFor="codelayer-provider" className="w-32 shrink-0 text-sm text-muted-foreground">
								Default Provider
							</Label>
							<Select
								value={defaultCodelayerProvider === 'xai' ? 'xai' : 'codex'}
								onValueChange={(value) =>
									setDefaultCodelayerProvider(SelectableModelProviderZodSchema.parse(value))
								}
							>
								<SelectTrigger id="codelayer-provider" className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{getVisibleProviderOptions(true).map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</section>
				)}

				{/* Codex Settings */}
				<section className="space-y-4 p-4 rounded-lg border border-border/50 bg-muted/30">
					<h3 className="text-sm font-semibold">Codex</h3>

					<div className="space-y-3">
						<div className="flex items-center gap-4">
							<Label
								htmlFor="codelayer-codex-model"
								className="w-32 shrink-0 text-sm text-muted-foreground"
							>
								Default Model
							</Label>
							<Select value={defaultCodelayerCodexModel} onValueChange={handleDefaultCodexModelChange}>
								<SelectTrigger id="codelayer-codex-model" className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{codexModelOptions.map((option) => (
										<SelectItem key={option.value} value={option.value} className="uppercase">
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="flex items-center gap-4">
							<Label
								htmlFor="codelayer-codex-effort"
								className="w-32 shrink-0 text-sm text-muted-foreground"
							>
								Default Effort
							</Label>
							<Select
								value={selectedCodexEffort}
								onValueChange={(value) => setDefaultCodelayerCodexEffort(value as CodexReasoningLevel)}
							>
								<SelectTrigger id="codelayer-codex-effort" className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{codexEffortLevels.map((level) => (
										<SelectItem key={level} value={level}>
											{level}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						{codexFastModeSupported && (
							<div className="flex items-center justify-between gap-4">
								<Label htmlFor="codelayer-codex-fast-mode" className="text-sm text-muted-foreground">
									Default Fast Mode
								</Label>
								<Switch
									id="codelayer-codex-fast-mode"
									checked={defaultCodelayerCodexFastMode}
									onCheckedChange={handleDefaultCodelayerCodexFastModeChange}
								/>
							</div>
						)}
					</div>
				</section>

				{useFoldCodingAgent && (
					<section className="space-y-4 p-4 rounded-lg border border-border/50 bg-muted/30">
						<h3 className="text-sm font-semibold">Grok</h3>
						<div className="flex items-center gap-4">
							<Label
								htmlFor="codelayer-xai-model"
								className="w-32 shrink-0 text-sm text-muted-foreground"
							>
								Default Model
							</Label>
							<Select value={defaultCodelayerXaiModel} onValueChange={handleDefaultXaiModelChange}>
								<SelectTrigger id="codelayer-xai-model" className="w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{codelayerXaiModelOptions.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="pt-4 border-t border-border/50">
							<p className="mb-2 text-sm text-muted-foreground">Authenticate Grok before using:</p>
							<div className="bg-muted/50 rounded-md p-3 font-mono text-xs break-all">
								{GROK_AUTH_COMMAND}
							</div>
						</div>
					</section>
				)}
			</div>
			<FastModeWarningDialog
				open={defaultCodelayerCodexFastModePendingEnable}
				onOpenChange={setDefaultCodelayerCodexFastModePendingEnable}
				onConfirm={confirmDefaultCodelayerCodexFastMode}
			/>
		</>
	)
}
