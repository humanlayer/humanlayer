import { type TableTask, TaskTable } from '@/components/task-table/TaskTable'

export interface ArchivedTasksTabProps {
	tasks: TableTask[]
	onActivateTask: (task: TableTask) => void
	onFocusArchivedTask: (task: TableTask) => void
	onBlurArchivedTask: () => void
}
export function ArchivedTasksTab({
	tasks,
	onActivateTask,
	onFocusArchivedTask,
	onBlurArchivedTask,
}: ArchivedTasksTabProps) {
	return tasks.length > 0 ? (
		<TaskTable
			tasks={tasks}
			focus={{ mode: 'store', cursor: 'archived-task' }}
			onRowClick={onActivateTask}
			onRowMouseEnter={onFocusArchivedTask}
			onRowMouseLeave={onBlurArchivedTask}
			hideActionMenu={true}
			onArchiveTask={null}
			onCreateSession={null}
			onManagePermissions={null}
		/>
	) : (
		<div className="flex items-center justify-center h-full text-muted-foreground">No archived tasks</div>
	)
}
