import { CODEX_REASONING_LEVELS_BY_MODEL, type CodexReasoningLevel } from '@humanlayer/ai/config'
import { FastModeToggle } from '@humanlayer/ui/components/fast-mode-toggle'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { getModelOptionsForAgentProvider, MODEL_OPTIONS } from '@humanlayer/ui/constants/models'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import { type ModelType, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useFastModeToggleGuard } from '@/hooks/useFastModeToggleGuard'

export function CodelayerDefaultsDisclosure() {
	const [open, setOpen] = useState(false)
	const codexModel = useSettingsStore((s) => s.defaultCodelayerCodexModel)
	const codexEffort = useSettingsStore((s) => s.defaultCodelayerCodexEffort)
	const codexFastMode = useSettingsStore((s) => s.defaultCodelayerCodexFastMode)
	const setCodexModel = useSettingsStore((s) => s.setDefaultCodelayerCodexModel)
	const setCodexEffort = useSettingsStore((s) => s.setDefaultCodelayerCodexEffort)
	const setCodexFastMode = useSettingsStore((s) => s.setDefaultCodelayerCodexFastMode)
	const { onToggle: onFastModeToggle } = useFastModeToggleGuard(setCodexFastMode)
	const modelOptions = getModelOptionsForAgentProvider({ agent: 'codelayer', provider: 'codex' })
	const selectedModelLabel = MODEL_OPTIONS.find((option) => option.value === codexModel)?.label ?? codexModel
	const codexReasoningLevels = CODEX_REASONING_LEVELS_BY_MODEL['gpt-5.5']
	if (codexReasoningLevels === undefined) return null

	return (
		<div className="border border-border bg-muted/20">
			<button
				type="button"
				className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
				onClick={() => setOpen((value) => !value)}
			>
				<span className="font-semibold text-foreground">Defaults</span>
				<span className="flex items-center gap-2 text-muted-foreground text-xs">
					{selectedModelLabel} · {codexEffort}
					<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
				</span>
			</button>
			{open && (
				<div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<Label>Model</Label>
						<Select value={codexModel} onValueChange={(value) => setCodexModel(value as ModelType)}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{modelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label>Effort</Label>
						<Select
							value={codexEffort}
							onValueChange={(value) => setCodexEffort(value as CodexReasoningLevel)}
						>
							<SelectTrigger className="uppercase">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{codexReasoningLevels.map((level) => (
									<SelectItem key={level} value={level} className="uppercase">
										{level}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="space-y-1.5">
						<Label>Fast Mode</Label>
						<FastModeToggle enabled={codexFastMode} onToggle={onFastModeToggle} className="h-9 px-3" />
					</div>
				</div>
			)}
		</div>
	)
}
