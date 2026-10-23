import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { createElectricSyncErrorHandler } from '@humanlayer/sync'
import { BasicIndex, createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import { DEFAULT_BACKOFF_OPTIONS } from '../types'

export type SessionsCollection = ReturnType<typeof createSessionsCollection>

/**
 * Create a new sessions collection with the given sync origin and identity.
 * @param syncOrigin - The Electric sync origin URL
 * @param token - The daemon authentication token
 * @param hostId - The host identifier
 */
export function createSessionsCollection(syncOrigin: string, token: string, hostId: string) {
	logger.debug('Initializing sessions electric collection')
	const sessionsElectricCollection = createCollection(
		electricCollectionOptions({
			schema: sessionSelectSchema,
			shapeOptions: {
				url: `${syncOrigin}/v1/sessions/${hostId}`,
				subsetMethod: 'POST',
				headers: {
					'x-daemon-authorization': token,
				},
				onError: createElectricSyncErrorHandler({
					collectionName: 'sessions',
					shouldRetryOnFailure: true,
					logger,
					captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
				}),
				backoffOptions: DEFAULT_BACKOFF_OPTIONS,
			},
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey: (item) => item.id,
			syncMode: 'on-demand',
		}),
	)
	logger.debug('Sessions electric collection initialized')

	return sessionsElectricCollection
}
