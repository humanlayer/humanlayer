import type { HorizontalTab } from '@/hooks/stores/horizontalTabsStore'

import { getHorizontalTabRoute } from './horizontalTabPresentation'

export type HorizontalTabNotificationDestination =
	| { kind: 'session'; sessionId: string; href: string }
	| { kind: 'workspace-setup'; taskId: string; href: string }

export function createSessionNotificationDestination(sessionId: string): HorizontalTabNotificationDestination {
	return { kind: 'session', sessionId, href: `/sessions/${sessionId}` }
}

export function createWorkspaceSetupNotificationDestination(taskId: string): HorizontalTabNotificationDestination {
	return { kind: 'workspace-setup', taskId, href: `/tasks/${taskId}?focus=workspace` }
}

export function findHorizontalTabForNotification(
	tabs: readonly HorizontalTab[],
	destination: HorizontalTabNotificationDestination,
): HorizontalTab | undefined {
	return tabs.find((tab) => {
		const route = getHorizontalTabRoute(tab.href)
		return destination.kind === 'session'
			? route.kind === 'session' && route.sessionId === destination.sessionId
			: route.kind === 'task' && route.taskId === destination.taskId
	})
}
