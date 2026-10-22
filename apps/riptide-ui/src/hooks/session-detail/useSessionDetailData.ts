import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useSessionEvents } from '@/hooks/useSessionEvents'
import { useSessionPermissions } from '@/hooks/useSessionPermissions'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'

/**
 * Data layer for the session detail page: live queries for the session row,
 * its events and approvals, the derived conversation state from
 * useSessionEvents, and the current user's permissions on the session.
 */
export function useSessionDetailData(sessionId: string, userId: string | undefined) {
	const {
		eventsCollection,
		sessionsCollection,
		approvalsCollection,
		queuedMessagesCollection,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	} = useSync()
	const { syncAuthReady } = useSyncInternal()
	const { membersMap } = useOrgMembers()

	// Query session data for working_directory, title, status
	const {
		data: sessionData,
		isReady: isSessionQueryReady,
		isLoading: isSessionLoading,
	} = useLiveQuery(
		(q) => q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId)),
		[sessionsCollection, sessionId],
	)
	const session = sessionData?.[0]
	// Electric marks a shape ready on any error, the missing access token included, so a
	// collection that never authenticated reports ready with zero rows. Callers use this
	// flag to decide "the session does not exist", so hold it until sync can authenticate.
	const isSessionReady = isSessionQueryReady && syncAuthReady

	// Compute task-level edit access for session permission check
	const taskForPermissionCheck = useMemo(
		() =>
			session?.task_id
				? { id: session.task_id, resource_owner_user_id: session.resource_owner_user_id }
				: undefined,
		[session?.task_id, session?.resource_owner_user_id],
	)
	const { canCreateSession: hasTaskEditPermission, effectivePermission } = useTaskPermissions(
		taskForPermissionCheck,
		userId,
		taskOrganizationAclsCollection,
		taskUserAclsCollection,
	)

	// Permission checks for shared sessions
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const { accessLevel, canManageSession, canSendPrompt, canResolveApproval } = useSessionPermissions(
		session,
		userId,
		effectivePermission,
		multiplayerPromptingEnabled,
	)

	// Query events for this session (no JOIN — approvals loaded independently).
	// Only the indexable eq(session_id) predicate lives in the query: a not() conjunct
	// defeats index optimization in tanstack-db, forcing a full-collection re-filter on
	// every sync commit batch. System events are filtered in useSessionEvents instead.
	const eventsQuery = useLiveQuery(
		(q) => q.from({ events: eventsCollection }).where(({ events }) => eq(events.session_id, sessionId)),
		[eventsCollection, sessionId],
	)

	// Query approvals by session_id — always available, doesn't depend on session loading
	const approvalsQuery = useLiveQuery(
		(q) => q.from({ approvals: approvalsCollection }).where(({ approvals }) => eq(approvals.session_id, sessionId)),
		[approvalsCollection, sessionId],
	)
	const queuedMessagesQuery = useLiveQuery(
		(q) =>
			q
				.from({ queuedMessages: queuedMessagesCollection })
				.where(({ queuedMessages }) =>
					and(eq(queuedMessages.session_id, sessionId), eq(queuedMessages.status, 'pending')),
				),
		[queuedMessagesCollection, sessionId],
	)

	// Transform raw DB events/approvals → ConversationEvent[] and compute all derived state
	const conversation = useSessionEvents({
		eventsQueryData: eventsQuery.data,
		approvalsQueryData: approvalsQuery.data,
		queuedMessageUserIds: (queuedMessagesQuery.data ?? []).map((message) => message.user_id),
		membersMap,
	})

	return {
		session,
		isSessionReady,
		isSessionLoading,
		approvals: approvalsQuery.data,
		approvalsReady: approvalsQuery.isReady,
		hasTaskEditPermission,
		accessLevel,
		canManageSession,
		canSendPrompt,
		canResolveApproval,
		conversation,
	}
}

export type SessionDetailSession = NonNullable<ReturnType<typeof useSessionDetailData>['session']>
export type SessionConversation = ReturnType<typeof useSessionDetailData>['conversation']
