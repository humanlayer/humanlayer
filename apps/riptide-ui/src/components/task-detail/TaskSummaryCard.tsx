import { Alert, AlertDescription, AlertTitle } from '@humanlayer/ui/components/alert'
import { Button } from '@humanlayer/ui/components/button'
import { useAuth } from '@workos-inc/authkit-react'
import { Archive } from 'lucide-react'
import { useState } from 'react'

import { OwnerReassignmentDialog } from '@/components/OwnerReassignmentDialog'
import { TaskSummary } from '@/components/TaskSummary'
import { useFirstOnlineHostId } from '@/hooks/live-queries/useFirstOnlineHostId'
import type { useTaskArtifactPanel } from '@/hooks/task-detail/useTaskArtifactPanel'
import type { LoadedTaskDetailPageState } from '@/hooks/task-detail/useTaskDetailPageState'
import { useTaskNextStep } from '@/hooks/task-detail/useTaskNextStep'
import { useTaskOwnerDisplay } from '@/hooks/task-detail/useTaskOwnerDisplay'
import { useKeybindingDisplays } from '@/hooks/useKeybindingDisplays'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { formatShortcut } from '@/hotkeysCatalog'
import { canReassignTaskOwner } from '@/lib/tasks/can-reassign-task-owner'
import { projectTaskSessionCreators } from '@/lib/tasks/project-task-people'
import { isDesktop } from '@/lib/utils'

type TaskArtifactPanel = ReturnType<typeof useTaskArtifactPanel>

/**
 * The header area of the task detail page: the archived-task banner and the
 * task summary card (name, directory, owner, artifacts, next-step action,
 * terminal toggle). Owns the next-step suggestion state and its hotkey.
 */
export function TaskSummaryCard({
	artifactPanel,
	taskDetail,
}: {
	artifactPanel: TaskArtifactPanel
	taskDetail: LoadedTaskDetailPageState
}) {
	const { taskId, task, data, sessionsTable, terminal, taskSummaryRef, onArchiveTask } = taskDetail
	const { role, roles } = useAuth()
	const [ownerDialogOpen, setOwnerDialogOpen] = useState(false)
	const { membersMap } = useOrgMembers()
	const fallbackHostId = useFirstOnlineHostId()
	const hostId = data.userHostId ?? fallbackHostId
	const { ownerMember, ownerFullName, ownerInitials } = useTaskOwnerDisplay(task.resource_owner_user_id)
	const participantMembers = projectTaskSessionCreators(task.resource_owner_user_id, data.sessions, membersMap)
	const canReassignOwner = canReassignTaskOwner(data.isOwner, role ?? null, roles ?? [])
	const keybindingDisplays = useKeybindingDisplays()

	const nextStep = useTaskNextStep({
		taskId,
		canCreateSession: data.canCreateSession,
		editingSessionId: sessionsTable.editingSessionId,
	})
	const taskSummaryTask = {
		...task,
		workspace_spec: task.workspace_spec ?? null,
		workspace_state: task.workspace_state ?? null,
	}
	let workspaceSetupStatus: 'ready' | 'setting_up' | 'needs_attention' | undefined
	if (data.workspaceSetup.activeRow?.error) workspaceSetupStatus = 'needs_attention'
	else if (data.workspaceSetup.activeRow?.status === 'done') workspaceSetupStatus = 'ready'
	else if (data.workspaceSetup.activeRow) workspaceSetupStatus = 'setting_up'

	return (
		<>
			{/* Archived task banner */}
			{task.archived && (
				<Alert className="shrink-0">
					<Archive className="h-4 w-4" />
					<AlertTitle>This task is archived</AlertTitle>
					{data.canEditTask && (
						<AlertDescription>
							<Button variant="outline" size="sm" onClick={onArchiveTask}>
								Unarchive
								<kbd className="ml-2 px-1.5 py-0.5 text-xs font-mono border rounded bg-muted">
									{formatShortcut(keybindingDisplays.archive)}
								</kbd>
							</Button>
						</AlertDescription>
					)}
				</Alert>
			)}

			{/* Task Summary — static height, always visible */}
			<div className="shrink-0">
				<div className="bg-foreground/6 p-4 font-mono">
					<TaskSummary
						ref={taskSummaryRef}
						task={taskSummaryTask}
						hostId={hostId}
						nextStepType={nextStep.nextStepData?.nextStepType ?? null}
						nextStepLabelOverride={nextStep.nextStepLabelOverride}
						nextStepVariant={nextStep.siblingSessionId ? 'outline' : undefined}
						hideActionsAndArtifacts={data.sessions.length === 0}
						workspaceSetupStatus={workspaceSetupStatus}
						resourceOwnerUserId={task.resource_owner_user_id}
						isEditHidden={!data.canEditTask}
						isCreateSessionHidden={!data.canCreateSession}
						ownerDisplayName={ownerFullName}
						ownerInitials={ownerInitials}
						ownerProfilePictureUrl={ownerMember?.profilePictureUrl}
						participantMembers={participantMembers}
						onOpenOwnerReassignment={canReassignOwner ? () => setOwnerDialogOpen(true) : undefined}
						onCreateSession={sessionsTable.handleCreateSession}
						onProceedToNextStep={nextStep.handleProceedToNextStep}
						onWorkspaceFocus={artifactPanel.handleWorkspaceFocus}
						onToggleTerminal={isDesktop() && data.canEditTask ? terminal.handleToggleTerminal : null}
						isTerminalOpen={terminal.isTerminalOpen}
					/>
				</div>
			</div>
			{(canReassignOwner || ownerDialogOpen) && (
				<OwnerReassignmentDialog
					open={ownerDialogOpen}
					taskId={taskId}
					taskName={task.name}
					currentOwnerUserId={task.resource_owner_user_id}
					onOpenChange={setOwnerDialogOpen}
				/>
			)}
		</>
	)
}
