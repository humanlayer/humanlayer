import { Button } from '@humanlayer/ui/components/button'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@humanlayer/ui/components/command'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Check, FolderKanban, Unlink } from 'lucide-react'

import { useSessionTaskAssignment } from '@/hooks/session-detail/useSessionTaskAssignment'
import { cn } from '@/lib/utils'

export function SessionTaskAssignmentDialog({
	session,
	open,
	onOpenChange,
}: {
	session: { id: string; task_id: string | null }
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const { taskOptions, handleTaskChange } = useSessionTaskAssignment({
		session,
		onDone: () => onOpenChange(false),
	})
	const hasTask = Boolean(session.task_id)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
				<DialogHeader className="border-b px-4 py-4">
					<DialogTitle>{hasTask ? 'Change task' : 'Add to task'}</DialogTitle>
					<DialogDescription>
						{hasTask ? 'Choose a new task for this session.' : 'Choose a task for this session.'}
					</DialogDescription>
				</DialogHeader>
				<Command className="rounded-none">
					<CommandInput autoFocus placeholder="Search tasks..." />
					<CommandList className="max-h-72">
						<CommandEmpty>No tasks found.</CommandEmpty>
						<CommandGroup>
							{taskOptions.map((task) => (
								<CommandItem
									key={task.id}
									value={task.name}
									keywords={[task.id]}
									onSelect={() => handleTaskChange(task.id)}
								>
									<FolderKanban className="h-4 w-4 shrink-0" />
									<span className="min-w-0 flex-1 truncate">{task.name}</span>
									{task.archived && <span className="text-xs text-muted-foreground">Archived</span>}
									<Check
										className={cn(
											'h-4 w-4 shrink-0',
											task.id === session.task_id ? 'opacity-100' : 'opacity-0',
										)}
									/>
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
				{hasTask && (
					<DialogFooter className="border-t p-3">
						<Button
							variant="ghost"
							className="text-destructive hover:text-destructive"
							onClick={() => handleTaskChange(null)}
						>
							<Unlink className="h-4 w-4" />
							Remove from task
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	)
}
