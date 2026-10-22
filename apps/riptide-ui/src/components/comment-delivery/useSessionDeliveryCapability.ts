import type { Session } from '@humanlayer/db/tables/sessions'
import type { ArtifactDeliveryCapability } from '@humanlayer/ui/artifact-viewer-v2'
import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Whether a session's agent takes a message now, takes it queued, or takes none at all. The one
 * reading of session status behind every delivery control; a caller that must also prove the
 * session belongs to a particular task adds that check on top.
 */
export function getSessionDeliveryCapability(
	session: Pick<Session, 'id' | 'status'> | null | undefined,
): ArtifactDeliveryCapability {
	if (!session) return { kind: 'copy' }
	if (
		session.status === 'running' ||
		session.status === 'needs_approval' ||
		session.status === 'waiting_for_usage_limit'
	) {
		return { kind: 'queue', sessionId: session.id }
	}
	if (
		session.status === 'ready_for_input' ||
		session.status === 'interrupted' ||
		session.status === 'failed' ||
		session.status === 'lost'
	) {
		return { kind: 'send', sessionId: session.id }
	}
	return { kind: 'copy' }
}

export function useSessionRow(sessionId: string | undefined): Session | null {
	const { sessionsCollection } = useSync()
	const sessionQuery = useLiveQuery(
		(q) =>
			sessionId
				? q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId))
				: undefined,
		[sessionsCollection, sessionId],
	)
	return (sessionQuery.data?.[0] as Session | undefined) ?? null
}

export function useSessionDeliveryCapability({
	sessionId,
}: {
	sessionId: string | undefined
}): ArtifactDeliveryCapability {
	return getSessionDeliveryCapability(useSessionRow(sessionId))
}
