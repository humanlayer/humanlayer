import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { BypassPermissionsDialog } from '@humanlayer/ui/components/bypass-permissions-dialog'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { FileText, Inbox } from 'lucide-react'
import { useCallback, useMemo } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { type TableTask, TaskTable } from '@/components/task-table/TaskTable'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useArchiveHotkey } from '@/hooks/hotkeys/useArchiveHotkey'
import { useDraftSessions } from '@/hooks/live-queries/useDraftSessions'
import { useDraftTasks } from '@/hooks/live-queries/useDraftTasks'
import { type DraftItem, useFocusStore } from '@/hooks/stores/focusStore'
import { useSessionRowActions } from '@/hooks/useSessionRowActions'
import { useSessionTableHotkeys } from '@/hooks/useSessionTableHotkeys'
import { useTaskActions } from '@/hooks/useTaskActions'
import { toTableSession } from '@/utils/session-transforms'
import { showUndoToast } from '@/utils/undoToast'

import { SessionTable } from '../session-table/SessionTable'

/**
 * The Drafts tab on the sessions list page: task drafts and session drafts.
 * Owns its data, the resume/archive draft actions, row actions for the
 * session-draft table, and the cross-table j/k focus navigation.
 */
export function DraftsTab() {
	const navigate = useNavigate()
	const { user } = useAuth()
	const taskActions = useTaskActions()
	const hasFocusedTaskDraft = useFocusStore((state) => state.focusedTaskDraftId !== null)

	// Fetch draft data
	const draftTasks = useDraftTasks(user?.id)
	const draftSessions = useDraftSessions(user?.id)

	// Transform data for tables
	const tableDraftSessions = useMemo(() => draftSessions.map(toTableSession), [draftSessions])
	const tableDraftTasks: TableTask[] = useMemo(
		() =>
			draftTasks.map((d) => ({
				id: d.id,
				name: d.name || 'Untitled Draft',
				lastActivityAt: d.updated_at ? new Date(Number(d.updated_at)).toISOString() : '',
				created_at: d.created_at ? Number(d.created_at) : undefined,
				sessionCount: 0,
				is_draft: true,
			})),
		[draftTasks],
	)

	const actions = useSessionRowActions(tableDraftSessions)

	const handleResumeTaskDraft = useCallback(
		(draftId: string) => {
			navigate({ to: '/tasks/new', search: { draftId } })
		},
		[navigate],
	)

	const handleArchiveTaskDraft = useCallback(
		(draftId: string) => {
			const draft = draftTasks.find((d) => d.id === draftId)
			const draftName = draft?.name || 'Untitled Draft'

			// Archive the task draft (soft delete)
			taskActions.archiveTask({ taskId: draftId, archived: true, cascadeToSessions: false })

			showUndoToast({
				type: 'archive_task',
				entityId: draftId,
				title: 'Draft Archived',
				description: draftName,
				onUndo: () => {
					taskActions.archiveTask({ taskId: draftId, archived: false, cascadeToSessions: false })
				},
			})

			// Move focus to next/previous draft
			const currentFocusedId = useFocusStore.getState().focusedTaskDraftId
			if (currentFocusedId === draftId) {
				const currentIndex = draftTasks.findIndex((d) => d.id === draftId)
				const nextDraft = draftTasks[currentIndex + 1] || draftTasks[currentIndex - 1]
				useFocusStore.getState().setFocusedTaskDraftId(nextDraft?.id ?? null, 'keyboard')
			}
		},
		[taskActions, draftTasks],
	)

	// Focus task draft on hover
	const handleFocusTaskDraft = useCallback((id: string) => {
		if (useFocusStore.getState().focusSource !== 'mouse') return
		useFocusStore.getState().setFocusedTaskDraftId(id, 'mouse')
	}, [])

	// Derive DraftItem arrays for store navigation methods
	const taskDraftItems: DraftItem[] = useMemo(() => draftTasks.map((d) => ({ id: d.id })), [draftTasks])
	const sessionDraftItems: DraftItem[] = useMemo(
		() => tableDraftSessions.map((s) => ({ id: s.id })),
		[tableDraftSessions],
	)

	// Session-draft table hotkeys; j/k navigate across both draft tables via the store
	useSessionTableHotkeys({
		sessions: tableDraftSessions,
		editingSessionId: actions.editingSessionId,
		scope: HOTKEY_SCOPES.SESSIONS_LIST,
		onFocusNext: () => useFocusStore.getState().focusNextDraft(taskDraftItems, sessionDraftItems),
		onFocusPrevious: () => useFocusStore.getState().focusPrevDraft(taskDraftItems, sessionDraftItems),
		onFocusFirst: () => {
			const firstTaskDraft = taskDraftItems[0]
			const firstSessionDraft = sessionDraftItems[0]
			const focusStore = useFocusStore.getState()
			if (firstTaskDraft) {
				focusStore.setFocusedSessionId(null, 'keyboard')
				focusStore.setFocusedTaskDraftId(firstTaskDraft.id, 'keyboard')
			} else if (firstSessionDraft) {
				focusStore.setFocusedTaskDraftId(null, 'keyboard')
				focusStore.setFocusedSessionId(firstSessionDraft.id, 'keyboard')
			}
		},
		onFocusLast: () => {
			const lastSessionDraft = sessionDraftItems.at(-1)
			const lastTaskDraft = taskDraftItems.at(-1)
			const focusStore = useFocusStore.getState()
			if (lastSessionDraft) {
				focusStore.setFocusedTaskDraftId(null, 'keyboard')
				focusStore.setFocusedSessionId(lastSessionDraft.id, 'keyboard')
			} else if (lastTaskDraft) {
				focusStore.setFocusedSessionId(null, 'keyboard')
				focusStore.setFocusedTaskDraftId(lastTaskDraft.id, 'keyboard')
			}
		},
		onActivateSession: actions.handleActivateSession,
		onActivateDraft: actions.handleActivateDraft,
		onStartEdit: actions.handleStartEdit,
		onArchiveOrDiscard: actions.handleArchiveOrDiscard,
		onBypassPermissions: actions.handleBypassPermissions,
		onAutoAcceptEdits: actions.handleAutoAcceptEdits,
	})

	// Enter - Resume editing focused task draft
	useHotkeys(
		'enter',
		() => {
			const focusedTaskDraftId = useFocusStore.getState().focusedTaskDraftId
			if (focusedTaskDraftId) handleResumeTaskDraft(focusedTaskDraftId)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSIONS_LIST],
			enabled: hasFocusedTaskDraft,
			preventDefault: true,
		},
		[handleResumeTaskDraft],
	)

	// Archive focused task draft (settings-selected binding)
	useArchiveHotkey(
		() => {
			const focusedTaskDraftId = useFocusStore.getState().focusedTaskDraftId
			if (focusedTaskDraftId) handleArchiveTaskDraft(focusedTaskDraftId)
		},
		{
			scopes: [HOTKEY_SCOPES.SESSIONS_LIST],
			enabled: hasFocusedTaskDraft,
		},
		[handleArchiveTaskDraft],
	)

	const hasTaskDrafts = tableDraftTasks.length > 0
	const hasSessionDrafts = tableDraftSessions.length > 0

	if (!hasTaskDrafts && !hasSessionDrafts) {
		return (
			<div className="flex flex-col items-center justify-center h-full py-16 text-muted-foreground">
				<Inbox className="w-12 h-12 mb-4 opacity-50" />
				<p className="text-lg font-medium mb-2">No drafts</p>
				<p className="text-sm">Saved task and session drafts will appear here</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-6">
			{/* Task Drafts Section */}
			{hasTaskDrafts && (
				<div>
					<h3 className="text-sm font-medium text-muted-foreground px-4 py-2 border-b flex items-center gap-2">
						<FileText className="w-4 h-4" />
						Task Drafts
					</h3>
					<TaskTable
						tasks={tableDraftTasks}
						focus={{ mode: 'store', cursor: 'task-draft' }}
						onRowClick={(task) => handleResumeTaskDraft(task.id)}
						onRowMouseEnter={(task) => handleFocusTaskDraft(task.id)}
						onArchiveTask={(task) => handleArchiveTaskDraft(task.id)}
						onCreateSession={null}
						onManagePermissions={null}
						hideLiveIndicators
					/>
				</div>
			)}

			{/* Session Drafts Section */}
			{hasSessionDrafts && (
				<div>
					<h3 className="text-sm font-medium text-muted-foreground px-4 py-2 border-b flex items-center gap-2">
						<FileText className="w-4 h-4" />
						Session Drafts
					</h3>
					<SessionTable
						sessions={tableDraftSessions}
						isArchivedView={false}
						isDraftsView={true}
						editingSessionId={actions.editingSessionId}
						onEditingChange={actions.setEditingSessionId}
						onFocusSession={actions.handleFocusSession}
						onBlurSession={actions.handleBlurSession}
						onActivateSession={actions.handleActivateSession}
						onActivateDraft={actions.handleActivateDraft}
						onSaveTitle={actions.handleSaveTitle}
						onOpenArchiveDialog={actions.handleArchiveOrDiscard}
						onOpenBypassDialog={actions.handleOpenBypassSessionDialog}
					/>
				</div>
			)}

			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				isActive={actions.bypassDialogOpen}
				rootScopeDisabled={true}
				componentName="BypassPermissionsDialog"
			>
				<BypassPermissionsDialog
					open={actions.bypassDialogOpen}
					onOpenChange={actions.setBypassDialogOpen}
					onConfirm={actions.handleBypassConfirm}
					sessionCount={actions.bypassSessionCount}
					hotkeyScope={HOTKEY_SCOPES.BYPASS_PERMISSIONS_DIALOG}
				/>
			</HotkeyScopeBoundary>
		</div>
	)
}
