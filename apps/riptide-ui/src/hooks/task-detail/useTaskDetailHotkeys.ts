import { useNavigate } from '@tanstack/react-router'
import type { RefObject } from 'react'

import { focusMainAndReleaseSpatialDomFocus } from '@/components/keyboard-focus-transfer'
import type { TableSession } from '@/components/session-table/types'
import type { TaskSummaryHandle } from '@/components/TaskSummary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useHoverCardStore } from '@/hooks/stores/hoverCardStore'
import type { useTaskArtifactPanel } from '@/hooks/task-detail/useTaskArtifactPanel'
import type { useTaskSessionsTable } from '@/hooks/task-detail/useTaskSessionsTable'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { copyTaskDeepLink } from '@/utils/sharing-links'

/**
 * Page-level hotkeys for the task detail page: create session (c), new task
 * (t), archive task (e), rename (shift+r), edit working directory (shift+d),
 * and the layered Escape handler (hover card → fullscreen viewer → artifact
 * panel → task/session edit → focus → blur → navigate back).
 */
export function useTaskDetailHotkeys({
	from,
	taskId,
	sessions,
	canEditTask,
	canCreateSession,
	taskSummaryRef,
	sessionsTable,
	artifactPanel,
	onArchiveTask,
}: {
	from: 'archive-tasks' | undefined
	taskId: string
	sessions: TableSession[]
	canEditTask: boolean
	canCreateSession: boolean
	taskSummaryRef: RefObject<TaskSummaryHandle | null>
	sessionsTable: ReturnType<typeof useTaskSessionsTable>
	artifactPanel: ReturnType<typeof useTaskArtifactPanel>
	onArchiveTask: () => void
}) {
	const navigate = useNavigate()
	const { editingSessionId, setEditingSessionId, handleCreateSession, handleStartEditSession } = sessionsTable
	const hasFocusedSession = useFocusStore((state) => state.focusedSessionId !== null)
	const { isFullscreen, closeFullscreen, selectedArtifactId, selectedArtifact, handleArtifactPanelClose } =
		artifactPanel
	const activeCommentHoverCardInfo = useHoverCardStore((s) => s.activeGutterInfo)
	const hideCommentHoverCard = useHoverCardStore((s) => s.hideNow)

	// c - Create session
	useAppHotkeys(
		'c',
		handleCreateSession,
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canCreateSession && editingSessionId === null,
			enableOnFormTags: false,
		},
		[handleCreateSession, canCreateSession, editingSessionId],
	)

	// t - Create new task
	useAppHotkeys(
		't',
		(e) => {
			e.stopPropagation()
			navigate({ to: '/tasks/new' })
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: editingSessionId === null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[navigate, editingSessionId],
	)

	// Escape - cancel overlays/editing, recover spatial ownership, then navigate back.
	useAppHotkeys(
		'Escape',
		(e) => {
			if (activeCommentHoverCardInfo) {
				e.preventDefault()
				e.stopPropagation()
				hideCommentHoverCard()
				return
			}

			// If fullscreen artifact viewer is open, close it instead of navigating
			if (isFullscreen) {
				e.preventDefault()
				closeFullscreen()
				return
			}

			// First outward step from the artifact surface preserves the open pane.
			if (selectedArtifactId && useFocusStore.getState().focusedArea === 'RIGHT_PANE') {
				e.preventDefault()
				e.stopImmediatePropagation()
				focusMainAndReleaseSpatialDomFocus()
				return
			}

			// A later Escape from MAIN closes the artifact panel.
			if (selectedArtifactId) {
				e.preventDefault()
				handleArtifactPanelClose()
				return
			}

			// Check if TaskSummary is editing - if so, let it handle ESC internally
			if (taskSummaryRef.current?.isEditing) {
				// ESC is handled by TaskSummary component's input onKeyDown
				// Don't navigate back, just let the component cancel
				return
			}

			// If editing a session title, cancel that
			if (editingSessionId !== null) {
				setEditingSessionId(null)
				return
			}

			// Clear focused session first if any
			if (useFocusStore.getState().focusedSessionId) {
				useFocusStore.getState().setFocusedSessionId(null, 'keyboard')
				return
			}

			if (useFocusStore.getState().focusedArea !== FOCUSED_AREAS.MAIN) {
				focusMainAndReleaseSpatialDomFocus()
				return
			}

			const activeEl = document.activeElement
			const isBodyOrNull = !activeEl || activeEl === document.body

			if (!isBodyOrNull && activeEl instanceof HTMLElement) {
				activeEl.blur()
				focusMainAndReleaseSpatialDomFocus()
				return
			}

			e.preventDefault()
			if (from === 'archive-tasks') {
				window.history.back()
			} else {
				// One return path: Board restores the previously focused card from
				// its in-memory focus store, so no route context is needed.
				navigate({ to: '/sessions', search: { tab: 'tasks' } })
			}
		},
		{
			// ARTIFACT_PANEL included so the "close artifact panel" rung works while
			// the panel's scope boundary is active (it replaces TASK_DETAIL as the
			// active scope whenever an artifact is open).
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: true,
			preventDefault: false, // Let component handle first
			enableOnFormTags: true, // Need to intercept in form fields
		},
		[
			navigate,
			editingSessionId,
			setEditingSessionId,
			from,
			activeCommentHoverCardInfo,
			hideCommentHoverCard,
			isFullscreen,
			closeFullscreen,
			selectedArtifactId,
			handleArtifactPanelClose,
		],
	)

	// Archive/unarchive task (settings-selected binding; only when no session is focused, owners only)
	useArchiveHotkey(
		onArchiveTask,
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			area: 'MAIN',
			enabled: canEditTask && !hasFocusedSession && editingSessionId === null && !selectedArtifact?.is_deleted,
			enableOnFormTags: false,
		},
		[onArchiveTask, hasFocusedSession, editingSessionId, canEditTask, selectedArtifact?.is_deleted],
	)

	// shift+r - Rename focused session OR task title (via TaskSummary)
	useAppHotkeys(
		'shift+r',
		() => {
			const focusedSessionId = useFocusStore.getState().focusedSessionId
			if (focusedSessionId !== null) {
				// Session is focused - rename session (only owners can rename)
				if (!canEditTask) return
				const session = sessions.find((s) => s.id === focusedSessionId)
				if (session) {
					handleStartEditSession(session)
				}
			} else if (canEditTask) {
				// No session focused - trigger task name edit via TaskSummary
				taskSummaryRef.current?.startEditName()
			}
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: editingSessionId === null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[sessions, handleStartEditSession, editingSessionId, canEditTask],
	)

	// shift+d - Edit default working directory (via TaskSummary)
	useAppHotkeys(
		'shift+d',
		() => {
			taskSummaryRef.current?.startEditDirectory()
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: canEditTask && !hasFocusedSession && editingSessionId === null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[canEditTask, hasFocusedSession, editingSessionId],
	)

	useAppHotkeys(
		hotkeysCatalog.taskDetail.shortcuts.copyPrimaryUrl.reactHotkeys,
		(e) => {
			e.preventDefault()
			void copyTaskDeepLink(taskId)
		},
		{
			scopes: [HOTKEY_SCOPES.TASK_DETAIL, HOTKEY_SCOPES.ARTIFACT_PANEL],
			enabled: editingSessionId === null,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[taskId, editingSessionId],
	)
}
