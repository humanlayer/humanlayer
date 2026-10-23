import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import { type FC, useCallback, useState } from 'react'
import { toast } from 'sonner'

import { SessionTable } from '@/components/session-table/SessionTable'
import type { TableSession } from '@/components/session-table/types'

import { useSessionTableHotkeys } from './hooks/use-session-table-hotkeys'

// Mock data
const MOCK_SESSIONS: TableSession[] = [
	{
		id: '1',
		title: 'Implement authentication flow',
		status: 'running',
		workingDirectory: '/Users/dev/projects/myapp',
		model: 'claude-sonnet-5',
		createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 min ago
		dangerouslySkipPermissions: false,
		autoAcceptEdits: false,
		isUnread: true,
	},
	{
		id: '2',
		title: 'Fix database connection pooling',
		status: 'needs_approval',
		workingDirectory: '/Users/dev/projects/myapp/backend',
		model: 'claude-sonnet-5',
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 min ago
		dangerouslySkipPermissions: true,
		autoAcceptEdits: false,
		isUnread: true,
	},
	{
		id: '3',
		title: 'Refactor component library',
		status: 'ready_for_input',
		workingDirectory: '/Users/dev/projects/ui-kit',
		model: 'claude-sonnet-5',
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), // 12 hours ago
		autoAcceptEdits: true,
	},
	{
		id: '4',
		summary: 'Debug performance issues in dashboard',
		status: 'ready_for_launch',
		workingDirectory: '/Users/dev/projects/dashboard',
		model: 'claude-opus-4-20250514',
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
	},
	{
		id: '5',
		title: 'Write unit tests for API',
		status: 'failed',
		workingDirectory: '/Users/dev/projects/api',
		model: 'claude-sonnet-5',
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), // 3 days ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
	},
]

const MOCK_DRAFTS: TableSession[] = [
	{
		id: 'd1',
		query: 'Help me implement a caching layer',
		status: 'draft',
		workingDirectory: '/Users/dev/projects/cache',
		createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
		isDraft: true,
	},
	{
		id: 'd2',
		query: 'Review security vulnerabilities',
		status: 'draft',
		workingDirectory: '/Users/dev/projects/security',
		createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
		isDraft: true,
	},
]

const MOCK_ARCHIVED: TableSession[] = [
	{
		id: 'a1',
		title: 'Old migration script',
		status: 'ready_for_input',
		workingDirectory: '/Users/dev/projects/legacy',
		model: 'claude-sonnet-5',
		createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // 30 days ago
		lastActivityAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 25).toISOString(),
		archived: true,
	},
]

const HOTKEY_SCOPE = 'session-table-demo'

export interface SessionTableWrapperProps {
	initialSessions?: TableSession[]
	isArchivedView?: boolean
	isDraftsView?: boolean
}

export const SessionTableWrapper: FC<SessionTableWrapperProps> = ({
	initialSessions,
	isArchivedView = false,
	isDraftsView = false,
}) => {
	// Determine which mock data to use
	const defaultSessions = isDraftsView ? MOCK_DRAFTS : isArchivedView ? MOCK_ARCHIVED : MOCK_SESSIONS

	const [sessions, setSessions] = useState<TableSession[]>(initialSessions ?? defaultSessions)
	const [focusedSessionId, setFocusedSessionId] = useState<string | null>(sessions[0]?.id ?? null)
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null)

	// Navigation
	const handleFocusNext = useCallback(() => {
		if (!focusedSessionId) {
			setFocusedSessionId(sessions[0]?.id ?? null)
			return
		}
		const currentIndex = sessions.findIndex((s) => s.id === focusedSessionId)
		const nextSession = sessions[currentIndex + 1]
		if (currentIndex < sessions.length - 1 && nextSession) {
			setFocusedSessionId(nextSession.id)
		}
	}, [focusedSessionId, sessions])

	const handleFocusPrevious = useCallback(() => {
		if (!focusedSessionId) {
			setFocusedSessionId(sessions[sessions.length - 1]?.id ?? null)
			return
		}
		const currentIndex = sessions.findIndex((s) => s.id === focusedSessionId)
		const prevSession = sessions[currentIndex - 1]
		if (currentIndex > 0 && prevSession) {
			setFocusedSessionId(prevSession.id)
		}
	}, [focusedSessionId, sessions])

	// Actions
	const handleActivateSession = useCallback((session: TableSession) => {
		toast.info(`Activated session: ${session.title || session.summary || session.id}`)
	}, [])

	const handleStartEdit = useCallback((session: TableSession) => {
		setEditingSessionId(session.id)
	}, [])

	const handleSaveTitle = useCallback((sessionId: string, newTitle: string) => {
		setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)))
		setEditingSessionId(null)
		toast.success(`Updated title to: ${newTitle}`)
	}, [])

	const handleArchiveOrDiscard = useCallback(
		(session: TableSession) => {
			if (session.isDraft || session.status === 'draft') {
				// Discard draft
				setSessions((prev) => prev.filter((s) => s.id !== session.id))
				toast.success(`Discarded draft: ${session.query || session.id}`)
			} else {
				// Archive session
				setSessions((prev) => prev.filter((s) => s.id !== session.id))
				toast.success(`Archived: ${session.title || session.summary || session.id}`)
			}

			// Move focus if this was focused
			if (focusedSessionId === session.id) {
				const currentIndex = sessions.findIndex((s) => s.id === session.id)
				const nextSession = sessions[currentIndex + 1] || sessions[currentIndex - 1]
				setFocusedSessionId(nextSession?.id ?? null)
			}
		},
		[focusedSessionId, sessions],
	)

	const handleBypassPermissions = useCallback((sessionId: string) => {
		setSessions((prev) =>
			prev.map((s) =>
				s.id === sessionId ? { ...s, dangerouslySkipPermissions: !s.dangerouslySkipPermissions } : s,
			),
		)
		toast.info('Toggled permissions bypass')
	}, [])

	const handleCreateSession = useCallback(() => {
		const newSession: TableSession = {
			id: `new-${Date.now()}`,
			title: 'New Session',
			status: 'draft',
			workingDirectory: '/Users/dev/projects/new',
			createdAt: new Date().toISOString(),
			lastActivityAt: new Date().toISOString(),
			isDraft: true,
		}
		setSessions((prev) => [newSession, ...prev])
		setFocusedSessionId(newSession.id)
		toast.success('Created new session')
	}, [])

	// Use hotkeys hook
	useSessionTableHotkeys({
		sessions,
		focusedSessionId,
		editingSessionId,
		scope: HOTKEY_SCOPE,
		enabled: true,
		onFocusNext: handleFocusNext,
		onFocusPrevious: handleFocusPrevious,
		onActivateSession: handleActivateSession,
		onStartEdit: handleStartEdit,
		onArchiveOrDiscard: handleArchiveOrDiscard,
		onBypassPermissions: handleBypassPermissions,
	})

	return (
		<div className="flex flex-col h-full">
			{/* Status bar */}
			<div className="flex items-center gap-4 p-2 text-xs text-muted-foreground border-b">
				<span>
					Focused: <code className="font-mono">{focusedSessionId || 'none'}</code>
				</span>
				<span>
					Editing: <code className="font-mono">{editingSessionId || 'none'}</code>
				</span>
			</div>

			{/* Hotkey hints */}
			<div className="flex flex-wrap gap-2 p-2 text-xs border-b">
				<kbd className="px-1.5 py-0.5 border rounded">j/k</kbd> Navigate
				<kbd className="px-1.5 py-0.5 border rounded">Enter</kbd> Activate
				<kbd className="px-1.5 py-0.5 border rounded">Shift+r</kbd> Rename
				<kbd className="px-1.5 py-0.5 border rounded">e</kbd> Archive
				<kbd className="px-1.5 py-0.5 border rounded">Alt+y</kbd> Bypass perms
			</div>

			{/* Table */}
			<div className="flex-1 overflow-auto">
				<SessionTable
					sessions={sessions}
					focusedSessionId={focusedSessionId}
					isArchivedView={isArchivedView}
					isDraftsView={isDraftsView}
					editingSessionId={editingSessionId}
					onEditingChange={setEditingSessionId}
					onFocusSession={(s) => setFocusedSessionId(s.id)}
					onBlurSession={() => {}}
					onActivateSession={handleActivateSession}
					onSaveTitle={(sessionId, newTitle) => {
						handleSaveTitle(sessionId, newTitle)
						setEditingSessionId(null)
					}}
					onCreateSession={handleCreateSession}
					onOpenCommandPalette={() => toast.info('Command palette would open')}
					onNavigateToSessions={() => toast.info('Would navigate to sessions')}
				/>
			</div>
		</div>
	)
}

// Wrap with HotkeysProvider for Storybook
export const SessionTableDemo: FC<SessionTableWrapperProps> = (props) => {
	return (
		<HotkeysProvider initiallyActiveScopes={[HOTKEY_SCOPE]}>
			<SessionTableWrapper {...props} />
		</HotkeysProvider>
	)
}
