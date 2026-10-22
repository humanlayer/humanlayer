import type { SidebarSession } from '@humanlayer/ui/components/sidebar/types'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMatch } from '@tanstack/react-router'
import { type RefObject, useCallback, useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'
import { useMountEffect } from '@/hooks/useMountEffect'

import type { ProjectSidebarTask } from './derive-project-sidebar'
import { projectSidebarNavigation } from './derive-project-sidebar'
import { projectTaskDisclosure, useProjectTaskDisclosure } from './project-task-disclosure'

export function useProjectSidebarNavigation(
	containerRef: RefObject<HTMLDivElement | null>,
	tasks: ProjectSidebarTask[],
	standaloneSessions: SidebarSession[],
) {
	const { sessionsCollection } = useSync()
	const expandedTaskIds = useSidebarStore((state) => state.expandedTaskIds)
	const manual = useProjectTaskDisclosure((state) => state.manual)
	const taskMatch = useMatch({ from: '/_app/tasks/$taskId', shouldThrow: false })
	const sessionMatch = useMatch({ from: '/_app/sessions/$sessionId', shouldThrow: false })
	const routeTaskId = taskMatch?.params.taskId
	const routeSessionId = sessionMatch?.params.sessionId
	const routeSessionQuery = useLiveQuery(
		(q) => {
			if (!routeSessionId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => eq(sessions.id, routeSessionId))
				.select(({ sessions }) => ({ taskId: sessions.task_id }))
		},
		[sessionsCollection, routeSessionId],
	)
	const selectedTaskId = routeTaskId ?? routeSessionQuery.data?.[0]?.taskId ?? undefined

	const effectiveExpandedTaskIds = useMemo(() => {
		const sessionTaskId = routeSessionQuery.data?.[0]?.taskId
		const expandedIds = new Set(expandedTaskIds)
		const effective: string[] = []
		for (const task of tasks) {
			const open = projectTaskDisclosure(
				task,
				manual[task.id],
				expandedIds.has(task.id) || task.id === sessionTaskId,
			).open
			if (open) effective.push(task.id)
		}
		return effective
	}, [tasks, manual, expandedTaskIds, routeSessionQuery.data])
	const visibleTasks = useMemo(
		() =>
			tasks.map((task) => ({ ...task, sessions: projectTaskDisclosure(task, manual[task.id], false).sessions })),
		[tasks, manual],
	)

	const navigableItems = useMemo(
		() =>
			projectSidebarNavigation(
				visibleTasks,
				effectiveExpandedTaskIds,
				standaloneSessions.map((session) => session.id),
			),
		[visibleTasks, effectiveExpandedTaskIds, standaloneSessions],
	)

	// Scroll lives here instead of focusStore because zustand stores shouldn't do DOM manipulation.
	// Subscribe imperatively so cursor movement does not rebuild the tree owner.
	useMountEffect(() => {
		return useFocusStore.subscribe((state, previousState) => {
			const next = state.focusedSidebarItem
			const previous = previousState.focusedSidebarItem
			if (!next || (next.type === previous?.type && next.id === previous.id) || !containerRef.current) return
			const selector =
				next.type === 'task'
					? `[data-sidebar-task-id="${CSS.escape(next.id)}"]`
					: `[data-sidebar-session-id="${CSS.escape(next.id)}"]`
			containerRef.current.querySelector(selector)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
		})
	})

	const focusNext = useCallback(() => {
		useFocusStore.getState().focusNextSidebarItem(navigableItems)
	}, [navigableItems])

	const focusPrev = useCallback(() => {
		useFocusStore.getState().focusPrevSidebarItem(navigableItems)
	}, [navigableItems])

	const jumpFirst = useCallback(() => {
		useFocusStore.getState().focusFirstSidebarItem(navigableItems)
	}, [navigableItems])

	const jumpLast = useCallback(() => {
		useFocusStore.getState().focusLastSidebarItem(navigableItems)
	}, [navigableItems])

	return {
		tasks: visibleTasks,
		standaloneSessions,
		effectiveExpandedTaskIds,
		routeTaskId,
		routeSessionId,
		selectedTaskId,
		navigableItems,
		focusNext,
		focusPrev,
		jumpFirst,
		jumpLast,
	}
}
