import type { SidebarSession } from '@humanlayer/ui/components/sidebar/types'
import { and, eq, isNull, not, useLiveQuery } from '@tanstack/react-db'
import { formatDistanceToNowStrict } from 'date-fns'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useUnreadStore } from '@/hooks/stores/unreadStore'

interface UseStandaloneSessionsOptions {
	userId: string | undefined
	limit?: number
}

interface UseStandaloneSessionsResult {
	sessions: SidebarSession[]
	isReady: boolean
}

/**
 * Fetches sessions without an associated task (standalone sessions), sorted by
 * most recent activity using 15-second bucketing to stabilize order during
 * parallel execution.
 */
export function useStandaloneSessions(options: UseStandaloneSessionsOptions): UseStandaloneSessionsResult {
	const { userId, limit = 5 } = options
	const { sessionsCollection } = useSync()
	const unreadSessionIds = useUnreadStore((s) => s.unreadSessionIds)

	const { data, isReady } = useLiveQuery(
		(q) => {
			if (!userId) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) =>
					and(
						isNull(sessions.task_id),
						eq(sessions.archived, false),
						eq(sessions.resource_owner_user_id, userId),
						not(eq(sessions.status, 'draft')),
					),
				)
				.select(({ sessions }) => ({
					id: sessions.id,
					owner_user_id: sessions.resource_owner_user_id,
					host_id: sessions.host_id,
					title: sessions.title,
					summary: sessions.summary,
					status: sessions.status,
					created_at: sessions.created_at,
					last_activity_at: sessions.last_activity_at,
					num_events: sessions.num_events,
				}))
				.orderBy(({ sessions }) => sessions.last_activity_at, 'desc')
		},
		[sessionsCollection, userId],
	)

	const sessions = useMemo((): SidebarSession[] => {
		if (!data) return []

		// Sort with 15-second bucketing to stabilize order during parallel execution
		const sorted = [...data].sort((a, b) => {
			const tsA = Number(a.last_activity_at ?? a.created_at)
			const tsB = Number(b.last_activity_at ?? b.created_at)
			const bucketA = Math.floor(tsA / 15000)
			const bucketB = Math.floor(tsB / 15000)
			if (bucketB !== bucketA) return bucketB - bucketA
			return Number(b.created_at) - Number(a.created_at)
		})

		const limited = limit > 0 ? sorted.slice(0, limit) : sorted

		return limited.map((row) => ({
			id: row.id,
			name: row.title || row.summary || 'Untitled session',
			ownerUserId: row.owner_user_id,
			hostId: row.host_id,
			status: toSidebarSessionStatus(row.status),
			createdAt: formatRelativeDate(row.last_activity_at ?? row.created_at),
			messageCount: row.num_events ?? undefined,
			isUnread: unreadSessionIds.has(row.id),
		}))
	}, [data, limit, unreadSessionIds])

	return { sessions, isReady }
}

function toSidebarSessionStatus(status: string | null | undefined): SidebarSession['status'] {
	switch (status) {
		case 'ready_for_launch':
		case 'launching':
		case 'running':
		case 'failed':
		case 'lost':
		case 'needs_approval':
		case 'interrupt_requested':
		case 'resuming':
		case 'waiting_for_usage_limit':
			return status
		case 'ready_for_input':
		case 'interrupted':
			return 'idle'
		default:
			return undefined
	}
}

function formatRelativeDate(value: bigint | null | undefined): string | undefined {
	if (!value) return undefined
	const timestamp = Number(value)
	if (!Number.isFinite(timestamp)) return undefined

	const diffMs = Date.now() - timestamp
	const diffMinutes = Math.max(0, Math.floor(diffMs / 60000))
	if (diffMinutes < 1) return 'now'
	if (diffMinutes < 60) return `${diffMinutes}m`

	const diffHours = Math.floor(diffMinutes / 60)
	if (diffHours < 24) return `${diffHours}h`

	const diffDays = Math.floor(diffHours / 24)
	if (diffDays < 7) return `${diffDays}d`

	return formatDistanceToNowStrict(timestamp, { unit: 'day' }).replace(/ days?$/, 'd')
}
