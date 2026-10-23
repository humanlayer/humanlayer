import type { SessionStatus, TaskStatus } from '@humanlayer/ui/components/sidebar/types'

import {
	NAVIGATION_PAGE_METADATA,
	type NavigationPageIcon,
	type NavigationPageMetadata,
} from '@/lib/navigation-page-metadata'
import { aggregateTaskStatus, type TaskStatusSessionInput } from '@/lib/taskStatus'

export type HorizontalTabIndicator =
	| { kind: 'task-status'; status: TaskStatus }
	| { kind: 'session-status'; status: SessionStatus }
	| { kind: 'unread' }
	| { kind: 'none' }

export type HorizontalTabPresentation = {
	label: string
	icon: NavigationPageIcon
	indicator: HorizontalTabIndicator
}

export type HorizontalTabRoute =
	| { kind: 'task'; taskId: string }
	| { kind: 'session'; sessionId: string }
	| { kind: 'page'; metadata: NavigationPageMetadata }

export type HorizontalTabTaskRecord = {
	name: string | null
}

export type HorizontalTabSessionRecord = TaskStatusSessionInput & {
	title: string | null
	summary: string | null
}

function parseHref(href: string): URL {
	return new URL(href, 'https://riptide.native')
}

export function getHorizontalTabRoute(href: string): HorizontalTabRoute {
	const url = parseHref(href)
	const segments = url.pathname.split('/').filter(Boolean)
	const [root, detail] = segments

	if (root === 'tasks' && detail === 'new') return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.newTask }
	if (root === 'tasks' && detail) return { kind: 'task', taskId: detail }
	if (root === 'sessions' && detail === 'draft') {
		return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.newSession }
	}
	if (root === 'sessions' && detail) return { kind: 'session', sessionId: detail }
	if (root === 'sessions' || root === undefined) {
		const tab = url.searchParams.get('tab')
		if (tab === 'sessions') return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.sessions }
		if (tab === 'drafts') return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.drafts }
		if (tab === 'context-shards') return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.contextShards }
		return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.tasks }
	}
	if (root === 'settings') return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.settings }
	if (root === 'archive' && detail === 'tasks') {
		return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.archivedTasks }
	}
	if (root === 'archive' && detail === 'sessions') {
		return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.archivedSessions }
	}

	return { kind: 'page', metadata: NAVIGATION_PAGE_METADATA.page }
}

function toSessionStatus(status: string | null): SessionStatus | undefined {
	switch (status) {
		case 'ready_for_launch':
		case 'launching':
		case 'running':
		case 'failed':
		case 'lost':
		case 'needs_approval':
		case 'waiting_for_usage_limit':
		case 'interrupt_requested':
		case 'resuming':
			return status
		case 'ready_for_input':
		case 'interrupted':
			return 'idle'
		default:
			return undefined
	}
}

function taskIndicator(sessions: readonly TaskStatusSessionInput[], isUnread: boolean): HorizontalTabIndicator {
	const status = aggregateTaskStatus(sessions)
	if (status) return { kind: 'task-status', status }
	return isUnread ? { kind: 'unread' } : { kind: 'none' }
}

function sessionIndicator(status: string | null, isUnread: boolean): HorizontalTabIndicator {
	const mappedStatus = toSessionStatus(status)
	if (mappedStatus && mappedStatus !== 'idle') return { kind: 'session-status', status: mappedStatus }
	return isUnread ? { kind: 'unread' } : { kind: 'none' }
}

export function getHorizontalTabPresentation(input: {
	href: string
	task?: HorizontalTabTaskRecord
	session?: HorizontalTabSessionRecord
	taskSessions?: readonly TaskStatusSessionInput[]
	isUnread?: boolean
	isTaskUnread?: boolean
}): HorizontalTabPresentation {
	const route = getHorizontalTabRoute(input.href)

	if (route.kind === 'task') {
		return {
			label: input.task?.name || 'Untitled task',
			icon: NAVIGATION_PAGE_METADATA.tasks.icon,
			indicator: taskIndicator(input.taskSessions ?? [], input.isTaskUnread ?? false),
		}
	}

	if (route.kind === 'session') {
		return {
			label: input.session?.title || input.session?.summary || 'Untitled session',
			icon: NAVIGATION_PAGE_METADATA.sessions.icon,
			indicator: sessionIndicator(input.session?.status ?? null, input.isUnread ?? false),
		}
	}

	return {
		label: route.metadata.label,
		icon: route.metadata.icon,
		indicator: { kind: 'none' },
	}
}
