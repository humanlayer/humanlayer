import type { SidebarItem } from '@humanlayer/ui/components/sidebar/types'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMatch } from '@tanstack/react-router'
import { type RefObject, useCallback, useEffect, useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'

import { useSidebarTaskTreeQuery } from './useSidebarTaskTreeQuery'

export function useSidebarNavigation(containerRef: RefObject<HTMLDivElement | null>) {
	const { tasks, standaloneSessions, isLoading, isReady } = useSidebarTaskTreeQuery()
	const { sessionsCollection } = useSync()
	const expandedTaskIds = useSidebarStore((state) => state.expandedTaskIds)
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
		if (!selectedTaskId || expandedTaskIds.includes(selectedTaskId)) return expandedTaskIds
		return [...expandedTaskIds, selectedTaskId]
	}, [expandedTaskIds, selectedTaskId])

	const navigableItems = useMemo((): SidebarItem[] => {
		const items: SidebarItem[] = []
		const expandedSet = new Set(effectiveExpandedTaskIds)

		for (const task of tasks) {
			items.push({ type: 'task', id: task.id })
			if (expandedSet.has(task.id)) {
				for (const session of task.sessions) {
					items.push({ type: 'session', id: session.id, taskId: task.id })
				}
			}
		}
		for (const session of standaloneSessions) {
			items.push({ type: 'standalone-session', id: session.id })
		}
		return items
	}, [effectiveExpandedTaskIds, tasks, standaloneSessions])

	// Scroll lives here instead of focusStore because zustand stores shouldn't do DOM manipulation.
	// Subscribe imperatively so cursor movement does not rebuild the tree owner.
	useEffect(() => {
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
	}, [containerRef])

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
		tasks,
		standaloneSessions,
		isLoading,
		isReady,
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
