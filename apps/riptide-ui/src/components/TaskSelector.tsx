import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import { Popover, PopoverContent, PopoverTrigger } from '@humanlayer/ui/components/popover'
import { cn } from '@humanlayer/ui/lib/utils'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'

export interface TaskOption {
	id: string
	name: string
}

interface TaskSelectorProps {
	value: string | null // task ID
	onChange: (taskId: string | null) => void
	tasks: TaskOption[]
	placeholder: string
	disabled?: boolean
	matchTriggerWidth?: boolean
}

export function TaskSelector({
	value,
	onChange,
	tasks,
	placeholder,
	disabled = false,
	matchTriggerWidth = false,
}: TaskSelectorProps) {
	const [open, setOpen] = useState(false)
	const listboxId = useId()

	// Get selected task for display
	const selectedTask = useMemo(() => tasks.find((t) => t.id === value), [tasks, value])

	const handleSelect = (taskId: string) => {
		// Toggle selection if clicking the same task
		const newValue = taskId === value ? null : taskId
		onChange(newValue)
		setOpen(false)
	}

	const handleClear = (e: React.MouseEvent) => {
		e.stopPropagation()
		e.preventDefault()
		onChange(null)
	}

	// Escape - close popover and exit editing mode
	useHotkeys(
		'Escape',
		(e) => {
			e.preventDefault()
			setOpen(false)
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_SELECTOR],
			enabled: open,
			enableOnFormTags: true,
		},
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.TASK_SELECTOR}
			isActive={open}
			rootScopeDisabled={false}
			componentName="TaskSelector"
		>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="outline"
						role="combobox"
						aria-expanded={open}
						aria-controls={listboxId}
						disabled={disabled}
						className={cn(
							'w-full justify-between font-normal normal-case tracking-normal group',
							!value && 'text-muted-foreground',
						)}
						onKeyDown={(e) => {
							// Don't intercept when modifier keys are pressed (allow cmd+enter, ctrl+enter hotkeys)
							if (e.metaKey || e.ctrlKey) return
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								e.stopPropagation()
								setOpen((open) => !open)
							}
						}}
					>
						<span className="truncate">{selectedTask?.name ?? placeholder}</span>
						<div className="flex items-center gap-1 ml-2 shrink-0 ">
							{value && (
								<span
									role="button"
									aria-label="Clear selection"
									tabIndex={-1}
									onClick={handleClear}
									className="text-muted-foreground hover:text-foreground p-0.5 rounded-sm hover:bg-accent/20 "
								>
									<X className="h-3 w-3 stroke-accent group-hover:stroke-background" />
								</span>
							)}
							<ChevronsUpDown className="h-4 w-4 stroke-accent group-hover:stroke-background" />
						</div>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					className={cn(
						'p-0',
						matchTriggerWidth
							? 'w-[var(--radix-popover-trigger-width)]'
							: 'min-w-[var(--radix-popover-trigger-width)]',
					)}
					align="start"
				>
					<Command>
						<CommandInput placeholder="Search tasks..." />
						<CommandList id={listboxId}>
							<CommandEmpty>{tasks.length === 0 ? 'No tasks available' : 'No tasks found'}</CommandEmpty>
							<CommandGroup>
								{tasks.map((task) => (
									<CommandItem key={task.id} value={task.name} onSelect={() => handleSelect(task.id)}>
										<Check
											className={cn(
												'mr-2 h-4 w-4',
												value === task.id ? 'opacity-100' : 'opacity-0',
											)}
										/>
										<span className="truncate">{task.name}</span>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</HotkeyScopeBoundary>
	)
}
