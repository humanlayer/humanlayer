import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUnreadStore } from '@/hooks/stores/unreadStore'

import { ThreadView } from './ThreadView'

const { useSessionThread, useSlashCommands, useTask, WorkspaceSetup, Composer, Transcript, scrollIntoView } =
	vi.hoisted(() => ({
		useSessionThread: vi.fn(),
		useSlashCommands: vi.fn(),
		useTask: vi.fn(),
		WorkspaceSetup: vi.fn(),
		Composer: vi.fn(),
		Transcript: vi.fn(),
		scrollIntoView: vi.fn(),
	}))

vi.mock('@/components/diffs/TaskDiffScope', () => ({
	TaskDiffScope: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/minimalist/components/WorkspaceSetup', () => ({ WorkspaceSetup }))
vi.mock('@/minimalist/components/Composer', () => ({ Composer }))
vi.mock('@/minimalist/components/Transcript', () => ({ Transcript }))
vi.mock('@/minimalist/components/AskCard', () => ({ AskCard: () => null }))
vi.mock('@/minimalist/components/BranchDialogs', () => ({ ForkDialog: () => null, HandoffDialog: () => null }))
vi.mock('@/minimalist/components/ChapterMenu', () => ({ ChapterMenu: () => null }))
vi.mock('@/minimalist/components/EnvironmentMenu', () => ({ EnvironmentMenu: () => null }))
vi.mock('@/minimalist/components/NextStepCard', () => ({ NextStepCard: () => null }))
vi.mock('@/minimalist/components/PromptAccessDialog', () => ({
	SharingPill: () => null,
	PromptAccessDialog: () => null,
}))
vi.mock('@/minimalist/components/SharedComposer', () => ({ SharedComposer: () => null }))
vi.mock('@/hooks/session-detail/use-response-editor-collaboration', () => ({
	useSharedResponseOptions: () => undefined,
}))
vi.mock('@/hooks/use-browser-auth', () => ({ useBrowserAuth: () => ({ user: null }) }))
vi.mock('@/minimalist/components/QueuedMessage', () => ({ QueuedMessage: () => null, QueueHeader: () => null }))
vi.mock('@/minimalist/components/ReviewPanel', () => ({ DiffStat: () => null }))
vi.mock('@/minimalist/components/SessionNotice', () => ({ SessionNotice: () => null, ReadOnlyNotice: () => null }))
vi.mock('@/minimalist/components/SidePanel', () => ({ SidePanel: () => null }))
vi.mock('@/minimalist/components/ThreadActions', () => ({ ThreadActions: () => null }))
vi.mock('@/minimalist/lib/access', () => ({
	useSessionAccess: () => ({ canSendPrompt: true, canResolveApproval: true }),
	usePromptSharing: () => ({ active: false, userIds: [], left: null }),
	isMultiplayerThread: () => false,
}))
vi.mock('@/minimalist/lib/data', () => ({
	useSessionThread,
	useHost: () => ({ host: null }),
	useTask,
	useTaskArtifacts: () => [],
	useSlashCommands,
}))
vi.mock('@/minimalist/lib/drafts', () => ({ useDraft: () => ['', vi.fn()] }))
vi.mock('@/minimalist/lib/models', () => ({ sessionSettings: () => ({}) }))
vi.mock('@/minimalist/lib/send', () => ({ useAskAgent: () => ({}), contextUsage: () => null }))
vi.mock('@/minimalist/lib/session-settings', () => ({ useSessionSettings: () => ({ catalog: { models: [] } }) }))
vi.mock('@/minimalist/lib/shortcuts', () => ({ shortcutHint: () => 'shortcut' }))
vi.mock('@/minimalist/lib/status', () => ({
	isBusy: (status: string) => ['running', 'waiting_for_workspace'].includes(status),
	statusAnnouncement: (status: string) => status,
}))
vi.mock('@/minimalist/lib/task-navigation', () => ({ useTaskNavigation: () => ({ search: {}, open: vi.fn() }) }))
vi.mock('@/minimalist/lib/thread-panel', () => ({ useThreadPanel: () => ({ show: false }) }))
vi.mock('@/minimalist/lib/thread-requests', () => ({ useThreadRequests: () => undefined }))
vi.mock('@/minimalist/lib/transcript', () => ({ buildTurns: () => [] }))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))
vi.mock('@/minimalist/lib/use-attachments', () => ({ useAttachments: () => ({}) }))
vi.mock('@/minimalist/lib/use-stick-to-bottom', () => ({ useStickToBottom: () => ({ away: false }) }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: {} }) }))

function session(status: string) {
	useSessionThread.mockReturnValue({
		session: { id: 'session', task_id: 'task', status, coding_agent: 'claude' },
		events: [],
		pendingApprovals: [],
		queued: [],
		isReady: true,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	useSlashCommands.mockReturnValue([])
	useTask.mockReturnValue({ task: { id: 'task', name: 'Task' } })
	session('running')
	WorkspaceSetup.mockImplementation(() => <div>Workspace recovery</div>)
	Composer.mockImplementation(() => <div>Composer</div>)
	Transcript.mockImplementation(() => <div>Transcript</div>)
	Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
})

describe('minimalist session header names', () => {
	it('updates a task-managed header from summary and keeps an explicit session name', () => {
		const current = {
			id: 'session',
			task_id: 'task',
			status: 'running',
			coding_agent: 'claude',
			title: null,
			summary: null as string | null,
		}
		const report = () =>
			useSessionThread.mockReturnValue({
				session: current,
				events: [],
				pendingApprovals: [],
				queued: [],
				isReady: true,
			})
		report()
		const view = render(<ThreadView sessionId="session" taskManaged />)
		expect(view.container.querySelector('.titlebar .title')).toHaveTextContent('Untitled session')
		current.summary = 'Generated summary'
		report()
		view.rerender(<ThreadView sessionId="session" taskManaged />)
		expect(view.container.querySelector('.titlebar .title')).toHaveTextContent('Generated summary')
		useSessionThread.mockReturnValue({
			session: { ...current, title: 'My session name' },
			events: [],
			pendingApprovals: [],
			queued: [],
			isReady: true,
		})
		view.rerender(<ThreadView sessionId="session" taskManaged />)
		expect(view.container.querySelector('.titlebar .title')).toHaveTextContent('My session name')
	})

	it('uses the summary for a standalone header and preserves the task name for the task-owned header', () => {
		useSessionThread.mockReturnValue({
			session: {
				id: 'session',
				task_id: null,
				status: 'running',
				coding_agent: 'claude',
				title: null,
				summary: 'Standalone summary',
			},
			events: [],
			pendingApprovals: [],
			queued: [],
			isReady: true,
		})
		useTask.mockReturnValue({ task: null })
		const view = render(<ThreadView sessionId="session" />)
		expect(view.container.querySelector('.titlebar .title')).toHaveTextContent('Standalone summary')
		useTask.mockReturnValue({ task: { id: 'task', name: 'Task name' } })
		view.rerender(<ThreadView sessionId="session" />)
		expect(view.container.querySelector('.titlebar .title')).toHaveTextContent('Task name')
	})
})

describe('minimalist session autocomplete context', () => {
	it.each(['claude', 'codelayer'])(
		'uses the %s session host and directory with response commands',
		(coding_agent) => {
			useSessionThread.mockReturnValue({
				session: {
					id: 'session',
					task_id: 'task',
					status: 'ready_for_input',
					coding_agent,
					host_id: 'session-host',
					working_directory: '/code/session',
				},
				events: [],
				pendingApprovals: [],
				queued: [],
				isReady: true,
			})
			render(<ThreadView sessionId="session" />)
			expect(useSlashCommands).toHaveBeenLastCalledWith({
				hostId: 'session-host',
				workspacePath: '/code/session',
				agent: coding_agent,
				continuingSession: true,
			})
		},
	)
})

describe('focused workspace setup', () => {
	it.each(['running', 'ready_for_input', 'needs_approval'])(
		'shows recovery for a %s session without treating it as waiting for setup',
		(status) => {
			session(status)
			render(<ThreadView sessionId="session" workspaceFocused />)
			expect(screen.getByText('Workspace recovery')).toBeTruthy()
			expect(screen.getByText('Transcript')).toBeTruthy()
			expect(screen.getByText('Composer')).toBeTruthy()
			expect(WorkspaceSetup).toHaveBeenLastCalledWith({ taskId: 'task', waitingForWorkspace: false }, undefined)
			expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
			expect(Composer.mock.lastCall?.[0].running).toBe(status === 'running')
			expect(Transcript.mock.lastCall?.[0].running).toBe(status === 'running')
			expect(Composer.mock.lastCall?.[0].placeholder).not.toContain('after setup succeeds')
		},
	)

	it('still shows blocked setup without workspace focus when the session waits for it', () => {
		session('waiting_for_workspace')
		render(<ThreadView sessionId="session" />)
		expect(WorkspaceSetup).toHaveBeenLastCalledWith({ taskId: 'task', waitingForWorkspace: true }, undefined)
		expect(Composer.mock.lastCall?.[0].placeholder).toBe('Queue a message. It sends after setup succeeds.')
		expect(Composer.mock.lastCall?.[0].running).toBe(false)
		expect(Transcript.mock.lastCall?.[0].running).toBe(false)
	})

	it('does not show setup for a running session until workspace focus arrives and hides it when focus clears', () => {
		const view = render(<ThreadView sessionId="session" />)
		expect(WorkspaceSetup).not.toHaveBeenCalled()
		view.rerender(<ThreadView sessionId="session" workspaceFocused />)
		expect(screen.getByText('Workspace recovery')).toBeTruthy()
		expect(scrollIntoView).toHaveBeenCalledOnce()
		view.rerender(<ThreadView sessionId="session" />)
		expect(screen.queryByText('Workspace recovery')).toBeNull()
	})
})

describe('visible-session unread state', () => {
	it('does not clear a hidden session and clears only the session that becomes visible', () => {
		useUnreadStore.setState({ unreadSessionIds: new Set(['session', 'sibling']) })
		const view = render(<ThreadView sessionId="session" taskManaged visible={false} />)
		expect(useUnreadStore.getState().unreadSessionIds).toEqual(new Set(['session', 'sibling']))
		view.rerender(<ThreadView sessionId="session" taskManaged visible />)
		expect(useUnreadStore.getState().unreadSessionIds).toEqual(new Set(['sibling']))
		view.rerender(<ThreadView sessionId="session" taskManaged visible={false} />)
		useUnreadStore.getState().markUnread('session')
		expect(useUnreadStore.getState().unreadSessionIds).toEqual(new Set(['session', 'sibling']))
	})
})
