import { Button } from '@humanlayer/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@humanlayer/ui/components/tabs'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Plus, Users } from 'lucide-react'
import { useMemo } from 'react'

import type { SessionsRouteTab, SessionsRouteTo } from '@/components/sessions-page/sessionsRoute'
import { useTaskHasNextStep } from '@/hooks/live-queries/useTaskHasNextStep'
import { useTaskMostProgressedLabel } from '@/hooks/live-queries/useTaskMostProgressedLabel'
import { useTaskStatuses } from '@/hooks/live-queries/useTaskStatuses'
import { type TaskWithActivity, useTasksByRecency } from '@/hooks/useTasksByRecency'
import { MobileTaskRow, type TaskStatus } from '@/mobile/components/pure/MobileTaskRow'
import { MobileAppLayout } from '@/mobile/layouts/MobileAppLayout'
import type { MobileTasksTab } from '@/mobile/pages/pure/MobileTasksListPage'

function computeTaskStatus(
	statuses: {
		needsApprovalCount: number
		mostRecentSessionFailed: boolean
		lostCount: number
		runningCount: number
		pendingCount: number
		interruptRequestedCount: number
	},
	hasNextStep: boolean,
): TaskStatus {
	if (statuses.needsApprovalCount > 0) return 'needs_approval'
	if (statuses.mostRecentSessionFailed) return 'failed'
	if (statuses.lostCount > 0) return 'lost'
	if (statuses.runningCount > 0) return 'running'
	if (statuses.pendingCount > 0) return 'pending'
	if (statuses.interruptRequestedCount > 0) return 'interrupt_requested'
	if (hasNextStep) return 'has_next_step'
	return 'idle'
}

/**
 * Per-task wired row — resolves label and status hooks for one task,
 * then renders the pure MobileTaskRow with a computed status string.
 */
function WiredMobileTaskRow({ task, onClick }: { task: TaskWithActivity; onClick: (taskId: string) => void }) {
	const { label } = useTaskMostProgressedLabel(task.id)
	const { hasNextStep } = useTaskHasNextStep(task.id)
	const statuses = useTaskStatuses(task.id)

	const status = computeTaskStatus(statuses, hasNextStep)

	return (
		<MobileTaskRow
			taskId={task.id}
			taskName={task.name}
			label={label ?? undefined}
			sessionCount={task.sessionCount}
			status={status}
			onClick={() => onClick(task.id)}
		/>
	)
}

/**
 * Wired mobile tasks list page.
 * Two tabs synced to the same `tab` search param the desktop sessions page uses:
 *   My Tasks — same ownership filter as the desktop tasks tab
 *   Shared Tasks — teammates' tasks, same filter as the desktop shared tasks tab
 * Fetches tasks via useTasksByRecency and renders them as touch-friendly rows.
 */
export function WiredMobileTasksListPage({ tab, routeTo }: { tab: SessionsRouteTab; routeTo: SessionsRouteTo }) {
	const navigate = useNavigate()
	const { user } = useAuth()

	const activeTab: MobileTasksTab = tab === 'shared-tasks' ? 'shared-tasks' : 'my-tasks'

	// Same filter as desktop sessions list tasks tab:
	// owned tasks + shared tasks where the current user has a session
	const { tasks: myTasks } = useTasksByRecency({ includeSessionsCreatedBy: user?.id })

	// Same filter as desktop shared tasks tab:
	// all visible tasks, minus the ones the current user owns
	const { tasks: allTasks } = useTasksByRecency({ ownedOnly: false, userId: user?.id })
	const sharedTasks = useMemo(() => {
		if (!user?.id) return []
		return allTasks.filter((t) => t.resource_owner_user_id !== user.id)
	}, [allTasks, user?.id])

	const handleTabChange = (nextTab: MobileTasksTab) => {
		navigate({ to: routeTo, search: { tab: nextTab === 'shared-tasks' ? 'shared-tasks' : 'tasks' } })
	}

	const handleTaskClick = (taskId: string) => {
		navigate({ to: '/tasks/$taskId', params: { taskId } })
	}

	const handleNewTask = () => {
		navigate({ to: '/tasks/new' })
	}

	const renderTaskRows = (tasks: TaskWithActivity[]) => (
		<div className="divide-y divide-border">
			{tasks.map((task) => (
				<WiredMobileTaskRow key={task.id} task={task} onClick={handleTaskClick} />
			))}
		</div>
	)

	return (
		<MobileAppLayout>
			<Tabs
				value={activeTab}
				onValueChange={(value) => handleTabChange(value as MobileTasksTab)}
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
							<Button onClick={handleNewTask} size="sm">
								<Plus className="h-4 w-4 mr-1" />
								New Task
							</Button>
						</div>
					) : (
						renderTaskRows(myTasks)
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
						renderTaskRows(sharedTasks)
					)}
				</TabsContent>
			</Tabs>

			{activeTab === 'my-tasks' && myTasks.length > 0 && (
				<div className="shrink-0 px-4 py-3 border-t border-border">
					<Button onClick={handleNewTask} className="w-full" size="sm">
						<Plus className="h-4 w-4 mr-1" />
						New Task
					</Button>
				</div>
			)}
		</MobileAppLayout>
	)
}
