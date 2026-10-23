import { isDefinedError } from '@orpc/client'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

import { useSync } from '@/components/providers/SyncProvider'
import { useSessionHostStatus } from '@/hooks/session-detail/useSessionHostStatus'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSessionActions } from '@/hooks/useSessionActions'
import { useSessionEvents } from '@/hooks/useSessionEvents'
import { useSessionPermissions } from '@/hooks/useSessionPermissions'
import { useSessionQueuedMessages } from '@/hooks/useSessionQueuedMessages'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useTaskSettings } from '@/hooks/useTaskSettings'
import { captureException } from '@/integrations/sentry/sentry'
import { getSenderPresentation } from '@/lib/sender-presentation'
import type { MobileArtifactItem } from '@/mobile/components/pure/MobileArtifactSheet'
import { WiredMobileArtifactsController } from '@/mobile/components/wired/WiredMobileArtifactsController'
import { WiredMobileSessionComposer } from '@/mobile/components/wired/WiredMobileSessionComposer'
import { useMobileApprovalFlow } from '@/mobile/hooks/useMobileApprovalFlow'
import { MobileSessionDetailPage } from '@/mobile/pages/pure/MobileSessionDetailPage'
import { useRiptideApi } from '@/orpc/client'
import { classifyDbArtifacts, extractOperationsByFilename } from '@/utils/sidebar-transforms'
import { showUndoToast } from '@/utils/undoToast'

interface WiredMobileSessionDetailPageProps {
	sessionId: string
}

/**
 * Wired mobile session detail page.
 *
 * Fetches events + approvals + artifacts. Composer, permissions, and approval
 * wiring live in dedicated hooks (useMobileSessionControls,
 * useMobileApprovalFlow) so this component stays focused on data-to-props.
 */
export function WiredMobileSessionDetailPage({ sessionId }: WiredMobileSessionDetailPageProps) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const {
		sessionsCollection,
		eventsCollection,
		approvalsCollection,
		artifactsMetadataCollection,
		tasksCollection,
		taskUserSettingsCollection,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	} = useSync()
	const { client } = useRiptideApi()
	const { membersMap } = useOrgMembers()

	const { data: sessionData } = useLiveQuery(
		(q) => q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId)),
		[sessionsCollection, sessionId],
	)
	const session = sessionData?.[0]
	const { hostDisplayName, isHostOffline } = useSessionHostStatus(session)

	const { data: taskData } = useLiveQuery(
		(q) =>
			session?.task_id
				? q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, session.task_id))
				: undefined,
		[tasksCollection, session?.task_id],
	)
	const currentTask = taskData?.[0]

	const sessionTitle = session?.title ?? session?.summary ?? session?.prompt ?? 'Session'

	const sessionActions = useSessionActions()
	const { settings: taskSettings, updateAutoAdvance } = useTaskSettings({
		task: currentTask,
		userId: user?.id,
		taskUserSettingsCollection,
		tasksCollection,
		api: { tasks: client.tasks },
	})
	// Task-ACL-derived edit access, exactly like desktop's useSessionDetailData —
	// a viewer who can't act on the session must not see send/approve controls.
	const taskForPermissionCheck = useMemo(
		() =>
			session?.task_id
				? { id: session.task_id, resource_owner_user_id: session.resource_owner_user_id }
				: undefined,
		[session?.task_id, session?.resource_owner_user_id],
	)
	const { effectivePermission } = useTaskPermissions(
		taskForPermissionCheck,
		user?.id,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const { canSendPrompt, canResolveApproval, canManageSession } = useSessionPermissions(
		session,
		user?.id,
		effectivePermission,
		multiplayerPromptingEnabled,
	)

	// Indexable eq-only predicate; system events are filtered in useSessionEvents (a not()
	// conjunct here would force a full-collection re-filter on every sync commit batch).
	const eventsQuery = useLiveQuery(
		(q) => q.from({ events: eventsCollection }).where(({ events }) => eq(events.session_id, sessionId)),
		[eventsCollection, sessionId],
	)

	const approvalsQuery = useLiveQuery(
		(q) => q.from({ approvals: approvalsCollection }).where(({ approvals }) => eq(approvals.session_id, sessionId)),
		[approvalsCollection, sessionId],
	)

	const { messages: rawQueuedMessages } = useSessionQueuedMessages(sessionId)
	const { events, toolResultsByKey, compactionSummaries, showSenderNames } = useSessionEvents({
		eventsQueryData: eventsQuery.data,
		approvalsQueryData: approvalsQuery.data,
		queuedMessageUserIds: rawQueuedMessages.map((message) => message.user_id),
		membersMap,
	})

	const { data: dbArtifacts } = useLiveQuery(
		(q) =>
			session?.task_id
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) =>
							and(eq(artifacts.task_id, session?.task_id ?? ''), eq(artifacts.is_deleted, false)),
						)
						.select(({ artifacts }) => ({
							id: artifacts.id,
							file_name: artifacts.file_name,
							task_slug: artifacts.task_slug,
							resource_owner_user_id: artifacts.resource_owner_user_id,
							share_key: artifacts.share_key,
							share_enabled: artifacts.share_enabled,
							storage_type: artifacts.storage_type,
						}))
						.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc')
				: undefined,
		[artifactsMetadataCollection, session?.task_id],
	)

	const artifacts: MobileArtifactItem[] = useMemo(() => {
		if (!dbArtifacts?.length) return []
		const operationsByFilename = extractOperationsByFilename(events)
		return classifyDbArtifacts(dbArtifacts, operationsByFilename).map((artifact) => ({
			artifactId: artifact.id ?? artifact.path,
			filename: artifact.path.split('/').pop() ?? artifact.path,
			category: artifact.categories[0] ?? 'unreferenced',
		}))
	}, [dbArtifacts, events])

	const {
		approvingApprovalId,
		denyingApproval,
		handleApprove,
		handleDeny,
		handleApproveWithSuggestions,
		handleDenyCancel,
		handleDenySubmit,
	} = useMobileApprovalFlow({
		events,
	})

	// Messages queued while the session is running (same data + actions as desktop's
	// SessionQueuedMessages). Compact mobile presentation with send-now + remove.
	const queuedMessages = useMemo(
		() =>
			rawQueuedMessages.map((message) => ({
				id: message.id,
				content: message.content,
				sender: message.user_id ? getSenderPresentation(membersMap.get(message.user_id)) : undefined,
				showSenderName: showSenderNames,
			})),
		[rawQueuedMessages, membersMap, showSenderNames],
	)
	const handleQueuedSendNow = useCallback(
		(queuedMessageId: string) => {
			const transaction = sessionActions.sendQueuedMessageNow({ sessionId, queuedMessageId })
			// Same error mapping as desktop's useSessionSendControls: a message that was
			// already delivered comes back as QUEUED_MESSAGE_SEND_FAILED.
			transaction.isPersisted.promise.catch((err: unknown) => {
				if (isDefinedError(err) && (err as { code?: string }).code === 'QUEUED_MESSAGE_SEND_FAILED') {
					toast.error('That message was already delivered')
				} else {
					toast.error('Could not send queued message')
				}
				captureException(err instanceof Error ? err : new Error(String(err)), {
					tags: { error_type: 'send_queued_now_failed' },
					extra: { sessionId },
				})
			})
		},
		[sessionActions, sessionId],
	)
	const handleQueuedRemove = useCallback(
		(queuedMessageId: string) => sessionActions.deleteQueuedMessage({ sessionId, queuedMessageId }),
		[sessionActions, sessionId],
	)

	const isDenying = !!denyingApproval

	const handleBack = useCallback(() => {
		if (session?.task_id) {
			navigate({ to: '/tasks/$taskId', params: { taskId: session.task_id } })
		} else {
			navigate({ to: '/sessions', search: { tab: 'sessions' } })
		}
	}, [navigate, session])

	// Archive/unarchive from the composer's action-button row, with undo toast
	// (mirrors desktop's useSessionArchiveAndTask minus terminal cleanup — no PTYs
	// on mobile).
	const handleToggleArchive = useCallback(() => {
		if (!session) return
		const newArchivedState = !(session.archived ?? false)

		sessionActions.archiveSession({ sessionId: session.id, archived: newArchivedState })

		showUndoToast({
			type: newArchivedState ? 'archive_session' : 'unarchive_session',
			entityId: session.id,
			title: newArchivedState ? 'Session Archived' : 'Session Un-archived',
			description: sessionTitle,
			onUndo: () => {
				sessionActions.archiveSession({ sessionId: session.id, archived: !newArchivedState })
			},
		})

		if (newArchivedState) handleBack()
	}, [session, sessionActions, sessionTitle, handleBack])

	return (
		<WiredMobileSessionComposer
			session={session}
			currentTask={currentTask}
			sessionActions={sessionActions}
			taskSettings={taskSettings}
			updateAutoAdvance={updateAutoAdvance}
			canSendPrompt={canSendPrompt}
			sessionId={sessionId}
			onToggleArchive={canManageSession ? handleToggleArchive : undefined}
			isDenying={isDenying}
			onDenySubmit={handleDenySubmit}
			onCancelDeny={handleDenyCancel}
		>
			{({ composer, sendMessageToSession, commentsUnreadCount, commentsUnreadArtifactIds }) => (
				<WiredMobileArtifactsController
					artifacts={artifacts.map((artifact) => ({
						...artifact,
						hasUnreadComments: commentsUnreadArtifactIds.has(artifact.artifactId),
					}))}
					unreadCount={commentsUnreadCount}
					onSendToSession={sendMessageToSession}
				>
					{({ trigger, sheet }) => (
						<MobileSessionDetailPage
							sessionId={sessionId}
							sessionTitle={sessionTitle}
							sessionHostName={hostDisplayName}
							isSessionHostOffline={isHostOffline}
							onBack={handleBack}
							events={events}
							toolResultsByKey={toolResultsByKey}
							compactionSummaries={compactionSummaries}
							workingDir={session?.working_directory ?? undefined}
							onApprove={handleApprove}
							onDeny={handleDeny}
							onApproveWithSuggestions={handleApproveWithSuggestions}
							approvalActionsHidden={!canResolveApproval || isHostOffline}
							showSenderNames={showSenderNames}
							approvingApprovalId={approvingApprovalId}
							denyingApprovalId={denyingApproval?.id ?? null}
							onCancelDeny={handleDenyCancel}
							queuedMessages={queuedMessages}
							onQueuedSendNow={canSendPrompt ? handleQueuedSendNow : undefined}
							onQueuedRemove={canSendPrompt ? handleQueuedRemove : undefined}
							composer={composer}
							artifactTrigger={trigger}
							artifactSheet={sheet}
						/>
					)}
				</WiredMobileArtifactsController>
			)}
		</WiredMobileSessionComposer>
	)
}
