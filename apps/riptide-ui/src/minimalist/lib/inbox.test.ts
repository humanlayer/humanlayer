import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TaskArtifact } from '@/hooks/live-queries/useTaskArtifacts'
import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import type { NotificationDestination, NotificationKind, NotificationRow } from '@/lib/notifications/notification-row'
import { useThreadPanel } from '@/minimalist/lib/thread-panel'

import { dismissNotification, useMinimalistInbox } from './inbox'

const artifacts: TaskArtifact[] = [
	{
		id: 'artifact-exact',
		file_name: 'plan.md',
		task_id: 'task-exact',
		task_slug: null,
		last_updated_at: null,
		resource_owner_user_id: null,
		share_key: null,
		share_enabled: false,
	},
]

const { useNotificationRows, navigate, navigateToDestination, closeSidebarOnNarrow, toastDismiss, route } = vi.hoisted(
	() => ({
		useNotificationRows: vi.fn(),
		navigate: vi.fn(),
		navigateToDestination: vi.fn(),
		closeSidebarOnNarrow: vi.fn(),
		toastDismiss: vi.fn(),
		route: {
			sessionId: null as string | null,
			taskId: null as string | null,
			taskRouteId: null as string | null,
			search: {} as Record<string, unknown>,
			state: {} as { relink?: number },
		},
	}),
)

vi.mock('@/hooks/useNotificationRows', () => ({ useNotificationRows }))
vi.mock('@/hooks/useNotificationDestinationNavigation', () => ({
	useNotificationDestinationNavigation: () => navigateToDestination,
}))
vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigate,
	useRouter: () => ({
		get state() {
			return {
				location: {
					pathname: route.sessionId ? `/sessions/${route.sessionId}` : `/tasks/${route.taskRouteId}`,
					search: route.search,
				},
			}
		},
	}),
	useSearch: () => route.search,
	useLocation: ({ select }: { select: (location: { state: typeof route.state }) => unknown }) =>
		select({ state: route.state }),
	useRouterState: () =>
		route.sessionId ? [{ routeId: '/_app/sessions/$sessionId', params: { sessionId: route.sessionId } }] : [],
}))
vi.mock('@tanstack/react-db', () => ({ eq: vi.fn(), queryOnce: async () => ({ task_id: route.taskId }) }))
vi.mock('@/minimalist/lib/data', () => ({ canReview: () => true }))
vi.mock('@/components/providers/SyncProvider', () => ({
	useSync: () => ({
		sessionsCollection: {
			state: new Map(route.sessionId ? [[route.sessionId, { task_id: route.taskId }]] : []),
		},
	}),
}))
vi.mock('@/minimalist/lib/ui-state', () => ({
	useUi: () => ({ closeSidebarOnNarrow, panelOpen: false, togglePanel: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { dismiss: toastDismiss } }))

function row(
	kind: NotificationKind,
	destination: NotificationDestination = { kind: 'session', sessionId: 'session-exact' },
): NotificationRow {
	return {
		key: `${kind}:id`,
		kind,
		destination,
		at: Date.now() - 1000,
		actors: [{ agent: true }],
		count: 1,
		subject: 'Subject',
		taskName: null,
		detail: null,
		dismissible: kind !== 'approval',
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	route.sessionId = null
	route.taskId = null
	route.taskRouteId = null
	route.search = {}
	route.state = {}
	navigate.mockImplementation((options) => {
		route.search = typeof options.search === 'function' ? options.search(route.search) : (options.search ?? {})
		route.state = options.state ?? {}
		if (options.to === '/tasks/$taskId') {
			route.sessionId = null
			route.taskRouteId = options.params.taskId
		}
	})
	useNotificationRows.mockReturnValue({ rows: [], synced: true })
	useNotificationInboxStore.setState({ seen: {}, opened: {}, open: true })
})

describe('useMinimalistInbox', () => {
	it('returns the shared rows in their exact order without filtering or grouping', () => {
		const rows = [row('ready_for_input'), row('approval'), row('session_failed')]
		useNotificationRows.mockReturnValue({ rows, synced: false })
		const { result } = renderHook(useMinimalistInbox)
		expect(result.current.rows).toBe(rows)
		expect(result.current.synced).toBe(false)
	})

	it.each<NotificationKind>(['approval', 'ready_for_input', 'session_failed', 'prompt_invite'])(
		'opens %s at its exact session, not the task',
		async (kind) => {
			const notification = row(kind)
			const { result } = renderHook(useMinimalistInbox)
			await act(async () => result.current.openNotification(notification))
			expect(navigateToDestination).toHaveBeenCalledWith({
				kind: 'session',
				sessionId: 'session-exact',
				href: '/sessions/session-exact',
			})
			expect(navigate).not.toHaveBeenCalled()
			expect(useNotificationInboxStore.getState().opened[notification.key]).toBeGreaterThanOrEqual(
				notification.at,
			)
			expect(useNotificationInboxStore.getState().seen[notification.key] !== undefined).toBe(
				kind === 'prompt_invite',
			)
			expect(useNotificationInboxStore.getState().open).toBe(false)
			expect(closeSidebarOnNarrow).toHaveBeenCalledOnce()
			expect(toastDismiss).toHaveBeenCalledWith('notification-arrival')
		},
	)

	it('opens workspace setup with workspace focus and keeps the failure outstanding', () => {
		const notification = row('workspace_setup_failed', { kind: 'workspace-setup', taskId: 'task-exact' })
		const { result } = renderHook(useMinimalistInbox)
		act(() => result.current.openNotification(notification))
		expect(navigateToDestination).toHaveBeenCalledWith({
			kind: 'workspace-setup',
			taskId: 'task-exact',
			href: '/tasks/task-exact?focus=workspace',
		})
		expect(useNotificationInboxStore.getState().seen[notification.key]).toBeUndefined()
	})

	it.each<NotificationKind>(['artifact_comment', 'thread_reply'])(
		'opens %s with its exact artifact and comment and clears it',
		async (kind) => {
			const notification = row(kind, {
				kind: 'artifact-comment',
				taskId: 'task-exact',
				artifactId: 'artifact-exact',
				commentId: 'comment-exact',
			})
			const { result } = renderHook(useMinimalistInbox)
			await act(async () => result.current.openNotification(notification))
			expect(navigate).toHaveBeenCalledWith({
				to: '/tasks/$taskId',
				params: { taskId: 'task-exact' },
				search: { artifactId: 'artifact-exact', commentId: 'comment-exact', session: undefined },
				state: { relink: expect.any(Number) },
			})
			expect(useNotificationInboxStore.getState().seen[notification.key]).toBeDefined()
			expect(useNotificationInboxStore.getState().opened[notification.key]).toBeDefined()
			expect(useNotificationInboxStore.getState().open).toBe(false)
			expect(closeSidebarOnNarrow).toHaveBeenCalledOnce()
			expect(toastDismiss).toHaveBeenCalledWith('notification-arrival')
		},
	)

	it('opens a diff comment in the side panel at its exact comment and clears it', async () => {
		const notification = row('diff_comment', {
			kind: 'diff-comment',
			taskId: 'task-exact',
			diffCommentId: 'diff-exact',
		})
		const { result } = renderHook(useMinimalistInbox)
		await act(async () => result.current.openNotification(notification))
		expect(navigate).toHaveBeenCalledWith({
			to: '/tasks/$taskId',
			params: { taskId: 'task-exact' },
			search: { diffCommentId: 'diff-exact', session: undefined },
			state: { relink: expect.any(Number) },
		})
		expect(useNotificationInboxStore.getState().seen[notification.key]).toBeDefined()
	})

	it.each(['artifact', 'diff'])(
		'keeps the current session on the same task for a %s comment and replaces the target',
		async (kind) => {
			route.sessionId = 'session-current'
			route.taskId = 'task-exact'
			route.search = {
				artifactId: 'old-artifact',
				commentId: 'old-comment',
				comment: 'old-reply',
				diffFileId: 'old-file',
				diffCommentId: 'old-diff',
				diffPresentation: 'fullscreen',
				focus: 'workspace',
			}
			const notification =
				kind === 'artifact'
					? row('artifact_comment', {
							kind: 'artifact-comment',
							taskId: 'task-exact',
							artifactId: 'artifact-exact',
							commentId: 'comment-exact',
						})
					: row('diff_comment', { kind: 'diff-comment', taskId: 'task-exact', diffCommentId: 'diff-exact' })
			const { result } = renderHook(useMinimalistInbox)
			await act(async () => result.current.openNotification(notification))
			expect(navigate).toHaveBeenCalledWith(
				expect.objectContaining({ to: '/tasks/$taskId', params: { taskId: 'task-exact' } }),
			)
			expect(route.search).toEqual(
				kind === 'artifact'
					? { session: 'session-current', artifactId: 'artifact-exact', commentId: 'comment-exact' }
					: { session: 'session-current', diffCommentId: 'diff-exact' },
			)
		},
	)

	it('does not use a current session from another task', async () => {
		route.sessionId = 'session-other'
		route.taskId = 'task-other'
		const { result } = renderHook(useMinimalistInbox)
		await act(async () =>
			result.current.openNotification(
				row('diff_comment', { kind: 'diff-comment', taskId: 'task-exact', diffCommentId: 'diff-exact' }),
			),
		)
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({ to: '/tasks/$taskId', params: { taskId: 'task-exact' } }),
		)
		expect(route.search.session).toBeUndefined()
	})

	it('opens artifact → diff → artifact without stale targets and keeps the selected session', async () => {
		route.sessionId = 'session-current'
		route.taskId = 'task-exact'
		const { result, rerender } = renderHook(() => ({
			inbox: useMinimalistInbox(),
			panel: useThreadPanel([], artifacts, { id: 'task-exact' } as Parameters<typeof useThreadPanel>[2]),
		}))
		const artifact = row('artifact_comment', {
			kind: 'artifact-comment',
			taskId: 'task-exact',
			artifactId: 'artifact-exact',
			commentId: 'comment-exact',
		})
		const diff = row('diff_comment', { kind: 'diff-comment', taskId: 'task-exact', diffCommentId: 'diff-exact' })
		for (const notification of [artifact, diff, artifact]) {
			await act(async () => result.current.inbox.openNotification(notification))
			rerender()
			expect(route.search).toEqual(
				notification === diff
					? { session: 'session-current', diffCommentId: 'diff-exact' }
					: { session: 'session-current', artifactId: 'artifact-exact', commentId: 'comment-exact' },
			)
			expect(result.current.panel.request).toEqual(
				notification === diff
					? { tab: 'review', file: undefined, comment: 'diff-exact' }
					: { tab: 'artifact:artifact-exact', comment: 'comment-exact' },
			)
			expect(result.current.panel.show).toBe(true)
		}
		expect(closeSidebarOnNarrow).toHaveBeenCalledTimes(3)
	})

	it.each(['artifact', 'diff'])('reopens the same %s notification after its panel was closed', async (kind) => {
		vi.useFakeTimers()
		try {
			route.taskRouteId = 'task-exact'
			route.search = { session: 'session-selected' }
			const notification =
				kind === 'artifact'
					? row('artifact_comment', {
							kind: 'artifact-comment',
							taskId: 'task-exact',
							artifactId: 'artifact-exact',
							commentId: 'comment-exact',
						})
					: row('diff_comment', { kind: 'diff-comment', taskId: 'task-exact', diffCommentId: 'diff-exact' })
			const { result, rerender } = renderHook(() => ({
				inbox: useMinimalistInbox(),
				panel: useThreadPanel([], artifacts, { id: 'task-exact' } as Parameters<typeof useThreadPanel>[2]),
			}))
			await act(async () => result.current.inbox.openNotification(notification))
			rerender()
			const search = route.search
			const firstRequest = result.current.panel.request
			expect(result.current.panel.show).toBe(true)
			act(() => result.current.panel.toggle())
			expect(result.current.panel.show).toBe(false)
			act(() => vi.advanceTimersByTime(1))
			await act(async () => result.current.inbox.openNotification(notification))
			rerender()
			expect(route.search).toEqual(search)
			expect(route.search.session).toBe('session-selected')
			expect(result.current.panel.request).toEqual(firstRequest)
			expect(result.current.panel.request).not.toBe(firstRequest)
			expect(result.current.panel.show).toBe(true)
			expect(useNotificationInboxStore.getState().opened[notification.key]).toBe(route.state.relink)
			expect(useNotificationInboxStore.getState().seen[notification.key]).toBe(route.state.relink)
			expect(toastDismiss).toHaveBeenCalledTimes(2)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('dismissNotification', () => {
	it('leaves pending approvals and open history unchanged', () => {
		expect(dismissNotification(row('approval'))).toBe(false)
		expect(useNotificationInboxStore.getState().seen).toEqual({})
		expect(useNotificationInboxStore.getState().opened).toEqual({})
	})

	it.each<NotificationKind>([
		'ready_for_input',
		'session_failed',
		'workspace_setup_failed',
		'prompt_invite',
		'artifact_comment',
		'thread_reply',
		'diff_comment',
	])('marks %s seen through the shared store without opening it', (kind) => {
		const notification = row(kind)
		expect(dismissNotification(notification)).toBe(true)
		expect(useNotificationInboxStore.getState().seen[notification.key]).toBeGreaterThanOrEqual(notification.at)
		expect(useNotificationInboxStore.getState().opened).toEqual({})
		expect(navigate).not.toHaveBeenCalled()
		expect(navigateToDestination).not.toHaveBeenCalled()
	})
})
