import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notificationRowView } from '@/components/notifications/notification-row-view'
import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import type { NotificationKind, NotificationRow } from '@/lib/notifications/notification-row'
import { deriveNotificationRows } from '@/lib/notifications/notification-rows'
import type { NotificationSources } from '@/lib/notifications/notification-sources'
import type { TaskRow } from '@/minimalist/lib/data'

import { Sidebar } from './Sidebar'

const {
	useNotificationRows,
	openNotification,
	useTaskTree,
	closeSidebarOnNarrow,
	toggleAttentionView,
	useUi,
	membersMap,
	offline,
} = vi.hoisted(() => ({
	useNotificationRows: vi.fn(),
	openNotification: vi.fn(),
	useTaskTree: vi.fn(),
	closeSidebarOnNarrow: vi.fn(),
	toggleAttentionView: vi.fn(),
	useUi: vi.fn(),
	membersMap: new Map([['sam', { id: 'sam', email: 'sam@example.com', firstName: 'Sam' }]]),
	offline: [],
}))

vi.mock('@/hooks/useNotificationRows', () => ({ useNotificationRows }))
vi.mock('@/hooks/useOpenNotification', () => ({ useOpenNotification: () => openNotification }))
vi.mock('@/hooks/useOrgMembers', () => ({ useOrgMembers: () => ({ membersMap }) }))
vi.mock('@/minimalist/lib/data', () => ({ useTaskTree, useOpenTaskId: () => 'busy' }))
vi.mock('@/minimalist/lib/thread-panel', () => ({ useOpenInTask: () => vi.fn() }))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi }))
vi.mock('@/minimalist/lib/shortcuts', () => ({ shortcutHint: () => 'shortcut' }))
vi.mock('@/minimalist/components/AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('@/minimalist/components/UpdateNotices', () => ({ UpdateLine: () => null }))
vi.mock('@/minimalist/components/ProjectList', () => ({ ProjectList: () => <div>Projects</div> }))
vi.mock('@/components/providers/SyncProvider', () => ({
	useSyncInternal: () => ({
		tracker: { onOfflineChange: () => () => {}, getOfflineCollections: () => offline },
	}),
}))
vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		params,
		onClick,
		className,
	}: {
		children: ReactNode
		to: string
		params?: { taskId?: string }
		onClick?: () => void
		className?: string
	}) => (
		<a href={to.replace('$taskId', params?.taskId ?? '')} onClick={onClick} className={className}>
			{children}
		</a>
	),
}))

const KINDS: NotificationKind[] = [
	'ready_for_input',
	'approval',
	'session_failed',
	'workspace_setup_failed',
	'prompt_invite',
	'artifact_comment',
	'thread_reply',
	'diff_comment',
]

function notifications(): NotificationRow[] {
	return KINDS.map((kind, index) => ({
		key: `${kind}:id`,
		kind,
		at: Date.now() - index * 60_000,
		actors: index >= 4 ? [{ userId: 'sam' }] : [{ agent: true }],
		count: kind === 'artifact_comment' ? 3 : 1,
		subject: `Subject ${index}`,
		taskName: 'Same task',
		detail: `Detail ${index}`,
		destination: { kind: 'session', sessionId: `session-${index}` },
		dismissible: kind !== 'approval',
	}))
}

function task(name: string, attention: TaskRow['attention']): TaskRow {
	return {
		task: { id: name, name } as TaskRow['task'],
		sessions: [],
		latest: null,
		projectName: 'Project',
		attention,
		lastActivity: Date.now(),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	useNotificationRows.mockReturnValue({ rows: notifications(), synced: true })
	useTaskTree.mockReturnValue({
		groups: [
			{
				tasks: [
					task('busy', 'running'),
					task('done', 'idle'),
					task('failed overview', 'failed'),
					task('approval overview', 'needs-you'),
				],
			},
		],
		isReady: true,
	})
	useUi.mockReturnValue({
		attentionView: true,
		toggleAttentionView,
		closeSidebarOnNarrow,
		setSearchOpen: vi.fn(),
		toggleSidebar: vi.fn(),
	})
	useNotificationInboxStore.setState({ seen: {}, opened: {}, open: false })
})

describe('minimalist Needs you', () => {
	it('renders every shared row in order, counts rows rather than comments or tasks, and keeps overview separate', () => {
		const rows = notifications()
		useNotificationRows.mockReturnValue({ rows, synced: true })
		render(<Sidebar />)
		const list = screen.getByRole('group', { name: 'Needs you' })
		expect(
			[...list.querySelectorAll('[data-notification-key]')].map((element) =>
				element.getAttribute('data-notification-key'),
			),
		).toEqual(rows.map((row) => row.key))
		const opens = within(list)
			.getAllByRole('button')
			.filter((button) => button.classList.contains('notification-row'))
		expect(opens).toHaveLength(rows.length)
		for (const [index, row] of rows.entries()) {
			const view = notificationRowView(row, membersMap)
			expect(opens[index]).toHaveTextContent(view.action)
			expect(opens[index]).toHaveTextContent(view.subject)
			expect(opens[index]).toHaveTextContent(view.detail ?? '')
			if (view.actorName) expect(opens[index]).toHaveTextContent(view.actorName)
			fireEvent.click(opens[index]!)
			expect(openNotification).toHaveBeenLastCalledWith(row)
		}
		expect(within(list).getByText('Needs you · 8')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'What needs you: 8' }).querySelector('.dot')).toBeTruthy()
		expect(closeSidebarOnNarrow).toHaveBeenCalledTimes(8)
		expect(within(list).queryByRole('link')).toBeNull()
		expect(screen.getByRole('link', { name: 'busy' })).toHaveAttribute('href', '/tasks/busy')
		expect(screen.getByRole('link', { name: 'done' })).toHaveAttribute('href', '/tasks/done')
		expect(screen.queryByText('failed overview')).toBeNull()
		expect(screen.queryByText('approval overview')).toBeNull()
		expect(useNotificationRows).toHaveBeenCalledTimes(1)
	})

	it('keeps notifications independent of task overview readiness', () => {
		useTaskTree.mockReturnValue({ groups: [], isReady: false })
		render(<Sidebar />)
		expect(within(screen.getByRole('group', { name: 'Needs you' })).getByText('Ready for input')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'What needs you: 8' })).toBeTruthy()
	})

	it('shows an empty inbox only after notification sync, regardless of failed task statuses', () => {
		useNotificationRows.mockReturnValue({ rows: [], synced: false })
		const view = render(<Sidebar />)
		expect(screen.queryByText('Nothing needs you')).toBeNull()
		useNotificationRows.mockReturnValue({ rows: [], synced: true })
		view.rerender(<Sidebar />)
		expect(screen.getByText('Nothing needs you')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'What needs you' }).querySelector('.dot')).toBeNull()
	})

	it('shows the same badge while viewing projects and toggles the view without marking rows seen', () => {
		useUi.mockReturnValue({
			attentionView: false,
			toggleAttentionView,
			closeSidebarOnNarrow,
			setSearchOpen: vi.fn(),
			toggleSidebar: vi.fn(),
		})
		render(<Sidebar />)
		fireEvent.click(screen.getByRole('button', { name: 'What needs you: 8' }))
		expect(toggleAttentionView).toHaveBeenCalledOnce()
		expect(screen.getByText('Projects')).toBeTruthy()
		expect(useNotificationInboxStore.getState().seen).toEqual({})
	})

	it('moves focus with arrows and J/K, and lets E dismiss only dismissible rows without reaching shell shortcuts', () => {
		const shellKey = vi.fn()
		render(
			<div onKeyDown={shellKey}>
				<Sidebar />
			</div>,
		)
		const list = screen.getByRole('group', { name: 'Needs you' })
		const ready = within(list).getByRole('button', { name: /Ready for input/ })
		const approval = within(list).getByRole('button', { name: /Needs approval/ })
		ready.focus()
		fireEvent.keyDown(ready, { key: 'ArrowDown' })
		expect(approval).toHaveFocus()
		fireEvent.keyDown(approval, { key: 'e' })
		expect(useNotificationInboxStore.getState().seen).toEqual({})
		expect(within(list).queryByRole('button', { name: 'Dismiss notification for Subject 1' })).toBeNull()
		fireEvent.keyDown(approval, { key: 'k' })
		expect(ready).toHaveFocus()
		const dismiss = within(list).getByRole('button', { name: 'Dismiss notification for Subject 0' })
		dismiss.focus()
		fireEvent.keyDown(dismiss, { key: 'e' })
		expect(useNotificationInboxStore.getState().seen['ready_for_input:id']).toBeDefined()
		expect(approval).toHaveFocus()
		expect(shellKey).not.toHaveBeenCalled()
		expect(openNotification).not.toHaveBeenCalled()
	})

	it('dismisses through shared seen state, updates row and badge together, and returns on a newer event', () => {
		const sources: NotificationSources = {
			userId: 'me',
			now: Date.now(),
			seen: {},
			multiplayerPromptingEnabled: false,
			unreadSessionIds: new Set(['ready']),
			sessions: [
				{
					id: 'ready',
					task_id: 'task',
					created_by: 'me',
					resource_owner_user_id: 'me',
					title: 'Ready session',
					summary: null,
					status: 'ready_for_input',
					error_message: null,
					archived: false,
					updated_at: Date.now() - 1000,
				},
			],
			tasks: [],
			approvals: [],
			artifacts: [],
			artifactComments: [],
			diffComments: [],
			workspaceSetups: [],
		}
		useNotificationRows.mockImplementation(() => {
			const seen = useNotificationInboxStore((state) => state.seen)
			return { rows: deriveNotificationRows({ ...sources, seen }), synced: true }
		})
		const view = render(<Sidebar />)
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification for Ready session' }))
		expect(screen.getByText('Nothing needs you')).toBeTruthy()
		expect(screen.getByRole('button', { name: 'What needs you' }).querySelector('.dot')).toBeNull()
		expect(screen.getByRole('group', { name: 'Needs you' })).toHaveFocus()
		expect(openNotification).not.toHaveBeenCalled()
		act(() => {
			sources.sessions[0]!.updated_at = Date.now() + 1
		})
		view.rerender(<Sidebar />)
		expect(screen.getByRole('button', { name: 'What needs you: 1' }).querySelector('.dot')).toBeTruthy()
		expect(screen.getByRole('button', { name: /Ready for input/ })).toBeTruthy()
	})
})
