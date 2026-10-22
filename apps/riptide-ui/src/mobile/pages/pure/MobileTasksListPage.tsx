import { Button } from '@humanlayer/ui/components/button'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import { Plus, Users } from 'lucide-react'
import type { FC } from 'react'

import { MobileTaskRow, type TaskStatus } from '@/mobile/components/pure/MobileTaskRow'
import { MobileAppLayout } from '@/mobile/layouts/MobileAppLayout'

export type MobileTasksTab = 'my-tasks' | 'shared-tasks'

export interface MobileTasksListTask {
	taskId: string
	taskName: string
	label?: SessionLabel
	sessionCount: number
	status: TaskStatus
}

export interface MobileTasksListPageProps {
	myTasks: MobileTasksListTask[]
	sharedTasks: MobileTasksListTask[]
	activeTab: MobileTasksTab
	onTabChange: (tab: MobileTasksTab) => void
	onTaskClick: (taskId: string) => void
	onNewTask?: () => void
}

function renderTaskRows(tasks: MobileTasksListTask[], onTaskClick: (taskId: string) => void) {
	return (
		<div className="divide-y divide-border">
			{tasks.map((task) => (
				<MobileTaskRow
					key={task.taskId}
					taskId={task.taskId}
					taskName={task.taskName}
					label={task.label}
					sessionCount={task.sessionCount}
					status={task.status}
					onClick={() => onTaskClick(task.taskId)}
				/>
			))}
		</div>
	)
}

/**
 * Mobile tasks list page — My Tasks / Shared Tasks tab toggle as the top bar
 * + scrollable task rows for the active tab.
 */
export const MobileTasksListPage: FC<MobileTasksListPageProps> = ({
	myTasks,
	sharedTasks,
	activeTab,
	onTabChange,
	onTaskClick,
	onNewTask,
}) => {
	return (
		<MobileAppLayout>
			<Tabs
				value={activeTab}
				onValueChange={(value) => onTabChange(value as MobileTasksTab)}
				className="flex min-h-0 flex-1 flex-col gap-0"
			>
				<div className="shrink-0 border-b border-border px-4 py-2">
					<TabsList className="grid h-10 w-full grid-cols-2">
						<TabsTrigger value="my-tasks">My Tasks</TabsTrigger>
						<TabsTrigger value="shared-tasks">Shared Tasks</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="my-tasks" className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{myTasks.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
							<p className="text-sm text-muted-foreground">No tasks yet.</p>
							{onNewTask && (
								<Button onClick={onNewTask} size="sm">
									<Plus className="h-4 w-4 mr-1" />
									New Task
								</Button>
							)}
						</div>
					) : (
						renderTaskRows(myTasks, onTaskClick)
					)}
				</TabsContent>

				<TabsContent value="shared-tasks" className="mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{sharedTasks.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
							<Users className="h-8 w-8 text-muted-foreground opacity-50" />
							<p className="text-sm font-medium">No shared tasks</p>
							<p className="text-sm text-muted-foreground">
								Tasks shared by your teammates will appear here
							</p>
						</div>
					) : (
						renderTaskRows(sharedTasks, onTaskClick)
					)}
				</TabsContent>
			</Tabs>

			{activeTab === 'my-tasks' && myTasks.length > 0 && onNewTask && (
				<div className="shrink-0 px-4 py-3 border-t border-border">
					<Button onClick={onNewTask} className="w-full" size="sm">
						<Plus className="h-4 w-4 mr-1" />
						New Task
					</Button>
				</div>
			)}
		</MobileAppLayout>
	)
}
