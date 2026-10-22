import { inArray, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

import { HostActiveSessions } from './HostActiveSessions'

export function HostActiveSessionsWired({
	sessionCount,
	activeSessionIds,
}: {
	sessionCount: number
	activeSessionIds: readonly string[] | undefined
}) {
	const { sessionsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) => {
			if (activeSessionIds === undefined || activeSessionIds.length === 0) return undefined
			return q
				.from({ sessions: sessionsCollection })
				.where(({ sessions }) => inArray(sessions.id, [...activeSessionIds]))
				.select(({ sessions }) => ({
					id: sessions.id,
					title: sessions.title,
					summary: sessions.summary,
				}))
		},
		[sessionsCollection, activeSessionIds],
	)

	const sessionsById = new Map((data ?? []).map((session) => [session.id, session]))
	const sessions = activeSessionIds?.flatMap((id) => {
		const session = sessionsById.get(id)
		if (!session) return []
		return [
			{
				id,
				title: session.title || session.summary || 'No title',
			},
		]
	})

	return <HostActiveSessions sessionCount={sessionCount} sessions={sessions} />
}
