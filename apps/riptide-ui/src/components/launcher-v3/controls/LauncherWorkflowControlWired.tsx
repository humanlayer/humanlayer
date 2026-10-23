import { Button } from '@humanlayer/ui/components/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@humanlayer/ui/components/dropdown-menu'
import { ChevronDown, Route } from 'lucide-react'
import { useRef } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import {
	NAMED_WORKFLOW_OPTIONS,
	selectTaskWorkflow,
	TASK_SIZE_WORKFLOW_OPTIONS,
	workflowChoiceForResolved,
	workflowLabel,
	type WorkflowAutoAdvanceMemory,
	type WorkflowSelectorChoice,
} from '@/modules/launcher-v3/launcher-v3-workflow'

export function LauncherWorkflowControlWired({
	control,
	disabled = false,
}: {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
}) {
	const { field: workflowType } = useController({ control, name: 'workflowType' })
	const { field: autoAdvance } = useController({ control, name: 'autoAdvance' })
	const { field: presentation } = useController({ control, name: 'workflowPresentation' })
	const { field: graphRevealed } = useController({ control, name: 'graphRevealed' })
	const openedRef = useRef(false)
	const memoryRef = useRef<WorkflowAutoAdvanceMemory>({ [workflowType.value]: autoAdvance.value })
	const workflow = { workflowType: workflowType.value, autoAdvance: autoAdvance.value }
	const options = presentation.value === 'task-size' ? TASK_SIZE_WORKFLOW_OPTIONS : NAMED_WORKFLOW_OPTIONS
	const selectedChoice = workflowChoiceForResolved(presentation.value, workflow)
	const selectedLabel = options.find((option) => option.value === selectedChoice)?.label ?? workflowLabel(workflow)

	const select = (choice: string) => {
		const next = selectTaskWorkflow(workflow, choice as WorkflowSelectorChoice, memoryRef.current)
		memoryRef.current = next.memory
		workflowType.onChange(next.workflow.workflowType)
		autoAdvance.onChange(next.workflow.autoAdvance)
	}

	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) openedRef.current = true
				else if (openedRef.current) graphRevealed.onChange(true)
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={`Workflow: ${selectedLabel}`}
					className="h-7 gap-1.5 px-2 text-xs text-foreground hover:text-accent data-[state=open]:border-accent data-[state=open]:bg-accent/10 data-[state=open]:text-accent"
				>
					<Route aria-hidden className="size-3.5" />
					<span className="group-data-[density=minimal]/tray:hidden">{selectedLabel}</span>
					<ChevronDown aria-hidden className="size-3 opacity-50" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-80">
				<DropdownMenuLabel className="font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
					{presentation.value === 'task-size'
						? 'How big is this task?'
						: 'How should HumanLayer run this task?'}
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={selectedChoice} onValueChange={select}>
					{options.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} className="items-start py-2">
							<span className="flex min-w-0 flex-col">
								<span>{option.label}</span>
								<span className="text-xs font-normal text-muted-foreground">{option.description}</span>
							</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
