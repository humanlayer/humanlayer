import { Button } from '@humanlayer/ui/components/button'
import { FolderKanban } from 'lucide-react'
import type { FC } from 'react'

interface TasksEmptyStateProps {
	onCreateTask?: () => void
}

export const TasksEmptyState: FC<TasksEmptyStateProps> = ({ onCreateTask }) => {
	return (
		<div className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground">
			<FolderKanban className="w-12 h-12 mb-4 opacity-50" />
			<p className="text-lg font-medium mb-2">No tasks yet</p>
			<p className="text-sm mb-4">Create a task to organize your sessions</p>
			{onCreateTask && (
				<Button onClick={onCreateTask} size="sm">
					Create Task
					<kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded bg-muted">T</kbd>
				</Button>
			)}
		</div>
	)
}
