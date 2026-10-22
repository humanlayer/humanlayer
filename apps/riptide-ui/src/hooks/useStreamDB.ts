import { createStreamDB } from '@durable-streams/state/db'
import { DURABLE_STREAM_READ_BACKOFF_OPTIONS, STREAM_CONFIG } from '@humanlayer/streams/config'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useEffect, useMemo } from 'react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { type RiptideStreamDB, streamSchema } from '@/collections/stream'
import { logger } from '@/lib/logger'
import { useRiptideApi } from '@/orpc/client'

export type StreamDBStatus = 'idle' | 'hydrating' | 'preloading' | 'ready' | 'error'

export type StreamDBState = {
	db: RiptideStreamDB
	status: StreamDBStatus
	error: unknown
}

const HYDRATION_MAX_ATTEMPTS = 10
const HYDRATION_INITIAL_DELAY_MS = 150
const HYDRATION_MAX_DELAY_MS = 500

const isNotFoundError = (error: unknown) =>
	error !== null && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND'

function streamDBStatus(queryStatus: string): StreamDBStatus {
	switch (queryStatus) {
		case 'pending':
			return 'hydrating'
		case 'success':
			return 'ready'
		case 'error':
			return 'error'
		default:
			return 'idle'
	}
}

export const useStreamDB = (sessionId: string): StreamDBState => {
	const { getAccessToken, isLoading } = useAuth()
	const { client } = useRiptideApi()

	const { db, instanceId } = useMemo(() => {
		const db = createStreamDB({
			streamOptions: {
				url: `${VITE_PUBLIC_SYNC_ORIGIN}/streams/sessions/${sessionId}`,
				contentType: STREAM_CONFIG.contentType,
				headers: {
					Authorization: async () => `Bearer ${await getAccessToken()}`,
				},
				backoffOptions: DURABLE_STREAM_READ_BACKOFF_OPTIONS,
			},
			live: 'sse',
			state: streamSchema,
		})
		// Preloading belongs to this db instance, not just the session's cached hydration result.
		return { db, instanceId: crypto.randomUUID() }
	}, [sessionId, getAccessToken])

	const { status: queryStatus, error } = useQuery({
		queryKey: ['stream-db-hydrate', sessionId, instanceId],
		queryFn: async () => {
			logger.info('[stream-db] hydrating', { sessionId })
			const hydrationResult = await client.durableStreams.sessions.getOrHydrate(
				{ sessionIds: [sessionId] },
				{ context: { silent: true } },
			)
			logger.info('[stream-db] hydrated', { sessionId, streams: hydrationResult.streams })

			logger.info('[stream-db] preloading', { sessionId })
			await db.preload()
			logger.info('[stream-db] ready', {
				sessionId,
				conversationEvents: db.collections.conversationEvents.size,
				messageStarts: db.collections.messageStarts.size,
				textBlockStarts: db.collections.textBlockStarts.size,
				textDeltas: db.collections.textDeltas.size,
				textBlockStops: db.collections.textBlockStops.size,
				thinkingBlockStarts: db.collections.thinkingBlockStarts.size,
				thinkingDeltas: db.collections.thinkingDeltas.size,
				thinkingBlockStops: db.collections.thinkingBlockStops.size,
				messageStops: db.collections.messageStops.size,
			})

			return hydrationResult
		},
		enabled: !isLoading,
		retry: (failureCount, error) => isNotFoundError(error) && failureCount < HYDRATION_MAX_ATTEMPTS,
		retryDelay: (attemptIndex) => Math.min(HYDRATION_INITIAL_DELAY_MS * 2 ** attemptIndex, HYDRATION_MAX_DELAY_MS),
	})

	useEffect(() => {
		return () => {
			db.close()
		}
	}, [db])

	const status = streamDBStatus(queryStatus)

	return { db, status, error }
}
