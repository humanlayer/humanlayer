import { Button } from '@humanlayer/ui/components/button'

import { SessionTable } from '@/components/session-table/SessionTable'
import { useIsTaskSharedWithOrg } from '@/hooks/live-queries/useIsTaskSharedWithOrg'
import { useFocusStore } from '@/hooks/stores/focusStore'
import type { useTaskArtifactPanel } from '@/hooks/task-detail/useTaskArtifactPanel'
import type { LoadedTaskDetailPageState } from '@/hooks/task-detail/useTaskDetailPageState'
import { useOrgMembers } from '@/hooks/useOrgMembers'

const noop = () => {}
type TaskArtifactPanel = ReturnType<typeof useTaskArtifactPanel>

/**
 * The sessions area of the task detail page: an empty state with a create
 * button when the task has no sessions, otherwise the session table wired to
 * the focus/edit/archive handlers.
 */
export function TaskSessionsArea({
	artifactPanel,
	taskDetail,
}: {
	artifactPanel: TaskArtifactPanel
	taskDetail: LoadedTaskDetailPageState
}) {
	const { taskId, task, data, sessionsTable } = taskDetail
	const { sessions, isOwner, canEditTask, canCreateSession } = data
	const { membersMap: orgMembers } = useOrgMembers()
	const isSharedWithOrg = useIsTaskSharedWithOrg(taskId)
	const {
		shouldIgnoreMouseEvent,
		editingSessionId,
		setEditingSessionId,
		handleActivateSession,
		handleActivateDraft,
		handleArchiveSession,
		handleCreateSession,
		handleSaveSessionTitle,
		handleOpenBypassSessionDialog,
	} = sessionsTable

	return (
		<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
			{sessions.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
					<p className="mb-4">No sessions in this task yet</p>
					{canCreateSession && (
						<Button onClick={handleCreateSession} size="lg">
							Create Session
							<kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded bg-muted">C</kbd>
						</Button>
					)}
				</div>
			) : (
				<div className="h-full overflow-hidden">
					<SessionTable
						sessions={sessions}
						hideTaskColumn={true}
						compactMode={!artifactPanel.isSidebarCollapsed}
						showCreatedBy={
							!isOwner || sessions.some((s) => s.createdByUserId !== task.resource_owner_user_id)
						}
						orgMembers={orgMembers}
						editingSessionId={canEditTask ? editingSessionId : null}
						onEditingChange={canEditTask ? setEditingSessionId : undefined}
						onFocusSession={(s) => {
							if (shouldIgnoreMouseEvent()) return
							useFocusStore.getState().setFocusedSessionId(s.id, 'mouse')
						}}
						onBlurSession={() => {
							if (shouldIgnoreMouseEvent()) return
							useFocusStore.getState().setFocusedSessionId(null, 'mouse')
						}}
						onActivateSession={handleActivateSession}
						onActivateDraft={handleActivateDraft}
						onSaveTitle={canEditTask ? handleSaveSessionTitle : noop}
						onOpenArchiveDialog={canEditTask ? handleArchiveSession : undefined}
						onOpenBypassDialog={canEditTask ? handleOpenBypassSessionDialog : undefined}
						isShareLinkHidden={!isSharedWithOrg}
						isArchiveActionHidden={!canEditTask}
						isBypassActionHidden={!canEditTask}
						stickyHeader={true}
					/>
				</div>
			)}
		</div>
	)
}
