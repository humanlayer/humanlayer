import { useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useNotificationInboxStore } from '@/hooks/stores/notificationInboxStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUnreadStore } from '@/hooks/stores/unreadStore'
import { useMinuteClock } from '@/hooks/useMinuteClock'
import type { NotificationRow } from '@/lib/notifications/notification-row'
import { deriveNotificationRows } from '@/lib/notifications/notification-rows'

export function useNotificationRows(): { rows: NotificationRow[]; synced: boolean } {
	const { user } = useAuth()
	const {
		approvalsCollection,
		artifactCommentsCollection,
		artifactsMetadataCollection,
		diffCommentsCollection,
		sessionsCollection,
		taskWorkspaceSetupForHostCollection,
		tasksCollection,
	} = useSync()
	const { syncAuthReady } = useSyncInternal()
	const now = useMinuteClock()
	const seen = useNotificationInboxStore((state) => state.seen)
	const multiplayerPromptingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const unreadSessionIds = useUnreadStore((state) => state.unreadSessionIds)

	const sessions = useLiveQuery((q) => q.from({ sessions: sessionsCollection }), [sessionsCollection])
	const approvals = useLiveQuery((q) => q.from({ approvals: approvalsCollection }), [approvalsCollection])
	const tasks = useLiveQuery((q) => q.from({ tasks: tasksCollection }), [tasksCollection])
	const artifacts = useLiveQuery(
		(q) => q.from({ artifacts: artifactsMetadataCollection }),
		[artifactsMetadataCollection],
	)
	const artifactComments = useLiveQuery(
		(q) => q.from({ comments: artifactCommentsCollection }),
		[artifactCommentsCollection],
	)
	const diffComments = useLiveQuery((q) => q.from({ comments: diffCommentsCollection }), [diffCommentsCollection])
	const workspaceSetups = useLiveQuery(
		(q) => q.from({ setups: taskWorkspaceSetupForHostCollection }),
		[taskWorkspaceSetupForHostCollection],
	)

	if (!user?.id) return { rows: [], synced: false }
	const synced =
		syncAuthReady &&
		[sessions, approvals, tasks, artifacts, artifactComments, diffComments, workspaceSetups].every(
			(query) => query.isReady,
		)
	const rows = deriveNotificationRows({
		userId: user.id,
		now,
		seen,
		multiplayerPromptingEnabled,
		unreadSessionIds,
		sessions: sessions.data,
		approvals: approvals.data,
		tasks: tasks.data,
		artifacts: artifacts.data,
		artifactComments: artifactComments.data,
		diffComments: diffComments.data,
		workspaceSetups: workspaceSetups.data,
	})
	return { rows, synced }
}
