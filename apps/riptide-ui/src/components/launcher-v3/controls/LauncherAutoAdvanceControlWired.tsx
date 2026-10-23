import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { SkipForward } from 'lucide-react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

export function LauncherAutoAdvanceControlWired({
	control,
	disabled = false,
}: {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
}) {
	const { field } = useController({ control, name: 'autoAdvance' })
	const workflowType = useWatch({ control, name: 'workflowType' })
	useHotkeys(
		hotkeysCatalog.sessionDetail.shortcuts.autoAdvance.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (disabled) return
			field.onChange(!field.value)
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
		[disabled, field.value, field.onChange],
	)
	const effectLabel = workflowType === 'outline_only' ? 'design' : workflowType === 'prd_tdd' ? 'PRD' : 'pull request'
	const label = `${field.value ? 'Disable' : 'Enable'} auto advance to ${effectLabel}`

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={disabled}
					aria-label={label}
					aria-pressed={field.value}
					className={cn(
						'size-7 border',
						field.value
							? 'border-[var(--terminal-success)] bg-[var(--terminal-success)]/15 text-[var(--terminal-success)] hover:bg-[var(--terminal-success)]/25'
							: 'border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
					)}
					onClick={() => field.onChange(!field.value)}
					onBlur={field.onBlur}
				>
					<SkipForward aria-hidden className="size-3.5 fill-current" />
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				<p>
					{workflowType === 'freeform'
						? 'automatically create a PR once implementation is finished'
						: `${field.value ? 'Auto advance' : 'Do not auto advance'} to ${effectLabel} when finished`}
				</p>
			</TooltipContent>
		</Tooltip>
	)
}
