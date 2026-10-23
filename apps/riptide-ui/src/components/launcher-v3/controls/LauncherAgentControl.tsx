import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import type { AgentOption } from '@humanlayer/ui/constants/agents'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'
import { ChevronDown } from 'lucide-react'

export interface LauncherAgentModelOption {
	value: string
	label: string
	effortLevels: readonly string[]
	defaultEffort: string | null
}

export interface LauncherAgentProviderOption {
	agent: AgentOption
	agentLabel: string
	provider: ProviderOption
	models: readonly LauncherAgentModelOption[]
}

export interface LauncherAgentSelection {
	agent: AgentOption
	provider: ProviderOption
	model: string
	effort: string | null
}

export interface LauncherAgentControlProps extends LauncherAgentSelection {
	options: readonly LauncherAgentProviderOption[]
	fastMode: boolean
	fastModeSupported: boolean
	disabled?: boolean
	onSelectAgentSettings: (selection: LauncherAgentSelection) => void
	onFastModeChange: (enabled: boolean) => void
	onBlur: () => void
}

const MENU_LABEL_CLASS = 'font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground'
const MENU_ITEM_CLASS = 'font-mono text-xs uppercase tracking-wider'

const EffortMeter = ({ level, levels }: { level: string | null; levels: readonly string[] }) => {
	const filled = level ? levels.indexOf(level) + 1 : 0
	return (
		<span aria-hidden className="flex items-end gap-[2px]" style={{ height: 11 }}>
			{levels.map((_, index) => (
				<span
					key={index}
					className={index < filled ? 'bg-accent' : 'bg-muted-foreground/50'}
					style={{ width: 2, height: 3 + index * 2 }}
				/>
			))}
		</span>
	)
}

const providerKey = (agent: AgentOption, provider: ProviderOption) => `${agent}:${provider}`

export function LauncherAgentControl({
	agent,
	provider,
	model,
	effort,
	options,
	fastMode,
	fastModeSupported,
	disabled = false,
	onSelectAgentSettings,
	onFastModeChange,
	onBlur,
}: LauncherAgentControlProps) {
	const selectedAgent = options.find((option) => option.agent === agent && option.provider === provider)
	const selectedModel = selectedAgent?.models.find((option) => option.value === model)
	const effortLevels = selectedModel?.effortLevels ?? []
	const models = selectedAgent?.models ?? []

	const selectModelWithDefaultEffort = (agentOption: LauncherAgentProviderOption, nextModel: string) => {
		const modelOption = agentOption.models.find((option) => option.value === nextModel)
		onSelectAgentSettings({
			agent: agentOption.agent,
			provider: agentOption.provider,
			model: nextModel,
			effort: modelOption?.defaultEffort ?? null,
		})
	}

	return (
		<div className="flex items-center gap-1">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-label="Agent"
						title="Agent (Shift+A)"
						disabled={disabled}
						onBlur={onBlur}
						className="h-7 min-w-0 gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent"
					>
						<span className="truncate">{selectedAgent?.agentLabel ?? agent}</span>
						<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent aria-label="Agent" align="end" className="w-48">
					<DropdownMenuLabel className={MENU_LABEL_CLASS}>Agent</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={selectedAgent ? providerKey(agent, provider) : ''}
						onValueChange={(nextKey) => {
							const agentOption = options.find(
								(option) => providerKey(option.agent, option.provider) === nextKey,
							)
							if (agentOption?.models[0])
								selectModelWithDefaultEffort(agentOption, agentOption.models[0].value)
						}}
					>
						{options.map((agentOption) => (
							<DropdownMenuRadioItem
								key={providerKey(agentOption.agent, agentOption.provider)}
								value={providerKey(agentOption.agent, agentOption.provider)}
								className={MENU_ITEM_CLASS}
							>
								{agentOption.agentLabel}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{models.length > 0 && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Model"
							title="Model (Shift+M)"
							disabled={disabled}
							onBlur={onBlur}
							className="h-7 min-w-0 max-w-full gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent"
						>
							<span className="truncate">{selectedModel?.label ?? model}</span>
							<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent aria-label="Model" align="end" className="w-56">
						<DropdownMenuLabel className={MENU_LABEL_CLASS}>Model</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={model}
							onValueChange={(nextModel) =>
								selectedAgent && selectModelWithDefaultEffort(selectedAgent, nextModel)
							}
						>
							{models.map((modelOption) => (
								<DropdownMenuRadioItem
									key={modelOption.value}
									value={modelOption.value}
									className={MENU_ITEM_CLASS}
								>
									{modelOption.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{effortLevels.length > 0 && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label="Reasoning effort"
							title="Reasoning effort (Shift+E)"
							disabled={disabled}
							onBlur={onBlur}
							className="h-7 min-w-0 gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent"
						>
							<EffortMeter level={effort} levels={effortLevels} />
							<span className="truncate uppercase">{effort ?? 'Effort'}</span>
							<ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent aria-label="Reasoning effort" align="end" className="w-44">
						<DropdownMenuLabel className={MENU_LABEL_CLASS}>Reasoning effort</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={effort ?? ''}
							onValueChange={(nextEffort) =>
								onSelectAgentSettings({ agent, provider, model, effort: nextEffort })
							}
						>
							{effortLevels.map((level) => (
								<DropdownMenuRadioItem key={level} value={level} className={MENU_ITEM_CLASS}>
									<span className="flex items-center gap-2">
										<EffortMeter level={level} levels={effortLevels} />
										{level}
									</span>
									{level === selectedModel?.defaultEffort && (
										<span className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground">
											default
										</span>
									)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			{fastModeSupported && <FastModeToggle enabled={fastMode} onToggle={onFastModeChange} disabled={disabled} />}
		</div>
	)
}
