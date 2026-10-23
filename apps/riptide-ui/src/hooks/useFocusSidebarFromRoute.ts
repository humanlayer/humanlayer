import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSidebarStore } from '@/hooks/stores/sidebarStore'

/**
 * Returns a callback that focuses the left nav and seeds the focused sidebar
 * item from the current route (the active session or task), expanding the
 * relevant task so the focused item is visible.
 *
 * The callback reads the route (`router.state.matches`) and the session's
 * `task_id` (`sessionsCollection.state.get(...)`) *synchronously at call time*
 * rather than from render-time hooks/live queries. This is deliberate: closing
 * over a `useLiveQuery` result would reintroduce the CORE-1326 race where focus
 * lands before the query resolves and nothing gets seeded. Reading the
 * collection at the moment of the keypress always uses the freshest value.
 */
export function useFocusSidebarFromRoute() {
	const router = useRouter()
	const { sessionsCollection } = useSync()

	return useCallback(() => {
		const { focusSidebar, setFocusedSidebarItem } = useFocusStore.getState()
		const { expandTask } = useSidebarStore.getState()

		// Always establish area focus, even if we can't resolve a route item below.
		focusSidebar()

		const matches = router.state.matches
		const sessionId = matches.find((m) => m.routeId === '/_app/sessions/$sessionId')?.params.sessionId as
			| string
			| undefined
		const taskId = matches.find((m) => m.routeId === '/_app/tasks/$taskId')?.params.taskId as string | undefined

		if (sessionId) {
			const sessionTaskId = sessionsCollection.state.get(sessionId)?.task_id
			if (sessionTaskId) {
				setFocusedSidebarItem({ type: 'session', id: sessionId, taskId: sessionTaskId })
				expandTask(sessionTaskId)
			} else {
				setFocusedSidebarItem({ type: 'standalone-session', id: sessionId })
			}
		} else if (taskId) {
			setFocusedSidebarItem({ type: 'task', id: taskId })
			expandTask(taskId)
		}
	}, [router, sessionsCollection])
}
