import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { ArchivedTasksTab } from '@/components/sessions-page/ArchivedTasksTab'
import type { TableTask } from '@/components/task-table/TaskTable'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useMinimalistLayout } from '@/hooks/use-minimalist-layout'
import { useTaskActions } from '@/hooks/useTaskActions'
import { useTasksByRecency } from '@/hooks/useTasksByRecency'

export const Route = createFileRoute('/_app/archive/tasks')({
	component: ArchivedTasksRoute,
})

/** The minimalist layout keeps its archive in settings. */
function ArchivedTasksRoute() {
	const minimalist = useMinimalistLayout()
	if (minimalist) return <Navigate to="/settings/archived" replace />
	return <ArchivedTasksPage />
}

function ArchivedTasksPage() {
	const navigate = useNavigate()
	const { user } = useAuth()
	const taskActions = useTaskActions()

	// Get archived tasks for keyboard navigation
	const { tasks } = useTasksByRecency({ archived: true, ownedOnly: true, userId: user?.id })
	const archivedTableTasks = useMemo(() => {
		return tasks.map((t) => ({
			...t,
			lastActivityAt: t.latestSessionActivity ? new Date(Number(t.latestSessionActivity)).toISOString() : '',
			created_at: Number(t.created_at),
		}))
	}, [tasks])

	const hasFocusedArchivedTask = useFocusStore((state) => state.focusedArchivedTaskId !== null)

	// Navigation handlers
	const handleFocusNext = useCallback(() => {
		if (archivedTableTasks.length === 0) return

		const focusedArchivedTaskId = useFocusStore.getState().focusedArchivedTaskId
		if (!focusedArchivedTaskId) {
			const firstTask = archivedTableTasks[0]
			if (firstTask === undefined) return
			useFocusStore.getState().setFocusedArchivedTaskId(firstTask.id, 'keyboard')
			return
		}
		const currentIndex = archivedTableTasks.findIndex((t) => t.id === focusedArchivedTaskId)
		// Wrap to first item if at last item, otherwise move to next
		const nextIndex = currentIndex >= archivedTableTasks.length - 1 ? 0 : currentIndex + 1
		const nextTask = archivedTableTasks[nextIndex]
		if (nextTask === undefined) return
		useFocusStore.getState().setFocusedArchivedTaskId(nextTask.id, 'keyboard')
	}, [archivedTableTasks])

	const handleFocusPrevious = useCallback(() => {
		if (archivedTableTasks.length === 0) return

		const focusedArchivedTaskId = useFocusStore.getState().focusedArchivedTaskId
		if (!focusedArchivedTaskId) {
			const lastTask = archivedTableTasks[archivedTableTasks.length - 1]
			if (lastTask === undefined) return
			useFocusStore.getState().setFocusedArchivedTaskId(lastTask.id, 'keyboard')
			return
		}
		const currentIndex = archivedTableTasks.findIndex((t) => t.id === focusedArchivedTaskId)
		// Wrap to last item if at first item, otherwise move to previous
		const nextIndex = currentIndex <= 0 ? archivedTableTasks.length - 1 : currentIndex - 1
		const prevTask = archivedTableTasks[nextIndex]
		if (prevTask === undefined) return
		useFocusStore.getState().setFocusedArchivedTaskId(prevTask.id, 'keyboard')
	}, [archivedTableTasks])

	const handleActivateTask = useCallback(
		(task: TableTask) => {
			if (task.is_draft) {
				// Unarchive the draft before navigating
				taskActions.archiveTask({
					taskId: task.id,
					archived: false,
					cascadeToSessions: false,
				})
				toast.success('Draft restored', {
					description: task.name || 'Untitled Draft',
				})
				navigate({ to: '/tasks/new', search: { draftId: task.id } })
			} else {
				navigate({ to: '/tasks/$taskId', params: { taskId: task.id }, search: { from: 'archive-tasks' } })
			}
		},
		[navigate, taskActions],
	)

	const handleActivateFocusedTask = useCallback(() => {
		const focusedArchivedTaskId = useFocusStore.getState().focusedArchivedTaskId
		if (!focusedArchivedTaskId) return
		const task = archivedTableTasks.find((t) => t.id === focusedArchivedTaskId)
		if (task) {
			handleActivateTask(task as TableTask)
		}
	}, [archivedTableTasks, handleActivateTask])

	// Escape - Navigate back to the default task home
	useHotkeys(
		'Escape',
		() => {
			if (window.history.length > 1) {
				window.history.back()
			} else {
				navigate({ to: '/sessions' })
			}
		},
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_TASKS],
			enabled: true,
			preventDefault: true,
		},
		[navigate],
	)

	// j - Navigate down
	useHotkeys(
		'j',
		() => handleFocusNext(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_TASKS],
			enabled: archivedTableTasks.length > 0,
			preventDefault: true,
		},
		[handleFocusNext, archivedTableTasks.length],
	)

	// k - Navigate up
	useHotkeys(
		'k',
		() => handleFocusPrevious(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_TASKS],
			enabled: archivedTableTasks.length > 0,
			preventDefault: true,
		},
		[handleFocusPrevious, archivedTableTasks.length],
	)

	// Enter - Activate focused task
	useHotkeys(
		'enter',
		() => handleActivateFocusedTask(),
		{
			scopes: [HOTKEY_SCOPES.ARCHIVE_TASKS],
			enabled: hasFocusedArchivedTask,
			preventDefault: true,
		},
		[handleActivateFocusedTask],
	)

	return (
		<HotkeyScopeBoundary scope={HOTKEY_SCOPES.ARCHIVE_TASKS} componentName="ArchivedTasksPage">
			<div className="flex flex-col h-full">
				<ArchivedTasksTab
					tasks={archivedTableTasks}
					onActivateTask={handleActivateTask}
					onFocusArchivedTask={(task) => {
						if (useFocusStore.getState().focusSource !== 'mouse') return
						useFocusStore.getState().setFocusedArchivedTaskId(task.id, 'mouse')
					}}
					onBlurArchivedTask={() => {}}
				/>
			</div>
		</HotkeyScopeBoundary>
	)
}
