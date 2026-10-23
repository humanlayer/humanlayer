import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { type TableTask, TaskTable } from '@/components/task-table'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useTaskTableHotkeys } from '@/hooks/useTaskTableHotkeys'
import { useSync } from '@/providers/SyncProvider'

export function TasksListPage() {
	const { artifactsMetadataCollection, tasksCollection } = useSync()
	const navigate = useNavigate()
	const { isLoading: isAuthLoading, organizationId, user } = useAuth()
	const { membersMap: orgMembers } = useOrgMembers()

	// Focus state from store
	const { focusedTaskId, setFocusedTaskId, focusSource } = useFocusStore()

	const shouldIgnoreMouseEvent = useCallback(() => {
		return focusSource !== 'mouse'
	}, [focusSource])

	const {
		data: tasks,
		isLoading,
		isError,
		isReady: isTasksReady,
	} = useLiveQuery(
		(q) =>
			q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.archived, false))
				.select(({ tasks }) => ({
					id: tasks.id,
					name: tasks.name,
					created_at: tasks.created_at,
					updated_at: tasks.updated_at,
					resource_owner_user_id: tasks.resource_owner_user_id,
				}))
				.orderBy(({ tasks }) => tasks.updated_at, 'desc'),
		[tasksCollection],
	)
	const {
		data: artifacts,
		isLoading: isLoadingArtifacts,
		isError: isArtifactsError,
		isReady: areArtifactsReady,
	} = useLiveQuery(
		(q) =>
			q.from({ artifacts: artifactsMetadataCollection }).select(({ artifacts }) => ({
				id: artifacts.id,
			})),
		[artifactsMetadataCollection],
	)

	const taskList = (tasks ?? []) as TableTask[]
	const hasNoTasks = taskList.length === 0
	const hasNoArtifacts = artifacts?.length === 0
	const isAuthenticatedInOrganization = !isAuthLoading && !!user && !!organizationId
	const hasLoadedTasks = isTasksReady && !isLoading
	const hasLoadedArtifacts = areArtifactsReady && !isLoadingArtifacts
	const shouldRedirectToInstall =
		isAuthenticatedInOrganization &&
		hasNoTasks &&
		hasLoadedTasks &&
		!isError &&
		hasNoArtifacts &&
		hasLoadedArtifacts &&
		!isArtifactsError

	// Navigation handlers
	const handleFocusNext = useCallback(() => {
		if (taskList.length === 0) return
		if (!focusedTaskId) {
			const first = taskList[0]
			if (first === undefined) return
			setFocusedTaskId(first.id, 'keyboard')
			return
		}
		const currentIndex = taskList.findIndex((t) => t.id === focusedTaskId)
		const nextIndex = currentIndex >= taskList.length - 1 ? 0 : currentIndex + 1
		const next = taskList[nextIndex]
		if (next === undefined) return
		setFocusedTaskId(next.id, 'keyboard')
	}, [focusedTaskId, taskList, setFocusedTaskId])

	const handleFocusPrevious = useCallback(() => {
		if (taskList.length === 0) return
		if (!focusedTaskId) {
			const last = taskList[taskList.length - 1]
			if (last === undefined) return
			setFocusedTaskId(last.id, 'keyboard')
			return
		}
		const currentIndex = taskList.findIndex((t) => t.id === focusedTaskId)
		const nextIndex = currentIndex <= 0 ? taskList.length - 1 : currentIndex - 1
		const prev = taskList[nextIndex]
		if (prev === undefined) return
		setFocusedTaskId(prev.id, 'keyboard')
	}, [focusedTaskId, taskList, setFocusedTaskId])

	const handleActivateTask = useCallback(
		(task: TableTask) => {
			navigate({ to: '/tasks/$taskId/artifacts', params: { taskId: task.id } })
		},
		[navigate],
	)

	// Table-level hotkeys
	useTaskTableHotkeys({
		tasks: taskList,
		focusedTaskId,
		scope: HOTKEY_SCOPES.TASKS_LIST,
		onFocusNext: handleFocusNext,
		onFocusPrevious: handleFocusPrevious,
		onActivateTask: handleActivateTask,
	})

	if (shouldRedirectToInstall) {
		return <Navigate to="/install" replace />
	}

	if (!isAuthenticatedInOrganization || (hasNoTasks && (!hasLoadedTasks || !hasLoadedArtifacts || hasNoArtifacts))) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3">
				<SyncGridAnimation variant="snake" speed={120} className="w-8 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">Loading tasks...</p>
			</div>
		)
	}

	if (hasNoTasks && isError) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<p className="text-destructive mb-4">Failed to load tasks</p>
					<button
						onClick={() => window.location.reload()}
						className="text-sm text-muted-foreground hover:underline"
					>
						Retry
					</button>
				</div>
			</div>
		)
	}

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.TASKS_LIST} componentName="TasksListPage">
			<div className="p-6">
				<TaskTable
					tasks={taskList}
					isLoading={isLoading}
					focusedTaskId={focusedTaskId}
					orgMembers={orgMembers}
					onFocusTask={(task) => {
						if (shouldIgnoreMouseEvent()) return
						setFocusedTaskId(task.id, 'mouse')
					}}
					onBlurTask={() => {}}
					onClickTask={handleActivateTask}
				/>
			</div>
		</HotkeyScopeBoundary>
	)
}
