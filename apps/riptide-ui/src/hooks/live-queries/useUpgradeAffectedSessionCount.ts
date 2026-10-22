import type { SessionStatus } from '@humanlayer/db/tables/sessions'
import { and, eq, inArray, not, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

const UPGRADE_AFFECTED_SESSION_STATUSES: SessionStatus[] = [
	'running',
	'needs_approval',
	'launching',
	'resuming',
	'waiting_for_usage_limit',
]

export interface UpgradeAffectedSessionCount {
	affectedSessionCount: number
	affectedSessionIds: string[]
	isLoading: boolean
	isReady: boolean
	isError: boolean
}

export interface UpgradeAffectedSessionCountInput {
	userId: string | null | undefined
	localHostId: string | null | undefined
	enabled: boolean
}

export function useUpgradeAffectedSessionCount({
	userId,
	localHostId,
	enabled,
}: UpgradeAffectedSessionCountInput): UpgradeAffectedSessionCount {
	const { sessionsCollection } = useSync()
	const queryEnabled = Boolean(enabled && userId && localHostId)

	const {
		data,
		isLoading,
		isReady: queryIsReady,
		isError,
	} = useLiveQuery(
		(q) => {
			if (!queryEnabled || !userId || !localHostId) return undefined

			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) =>
					and(
						not(eq(sessions.archived, true)),
						eq(sessions.resource_owner_user_id, userId),
						eq(sessions.host_id, localHostId),
						inArray(sessions.status, UPGRADE_AFFECTED_SESSION_STATUSES),
					),
				)
				.select(({ sessions }) => ({ id: sessions.id }))
		},
		[sessionsCollection, queryEnabled, userId, localHostId],
	)
	const affectedSessionIds = data?.map(({ id }) => id) ?? []

	return {
		affectedSessionCount: affectedSessionIds.length,
		affectedSessionIds,
		isLoading: queryEnabled && isLoading,
		isReady: queryEnabled && queryIsReady,
		isError: queryEnabled && isError,
	}
}
