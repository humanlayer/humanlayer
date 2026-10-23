import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'
import { createElectricSyncErrorHandler } from '@humanlayer/sync'
import { BasicIndex, createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

import { Sentry } from '@/instrument'
import logger from '@/logger'

import { DEFAULT_BACKOFF_OPTIONS } from '../types'

export type ApprovalsCollection = ReturnType<typeof createApprovalsCollection>

/**
 * Create a new approvals collection with the given sync origin and identity.
 * @param syncOrigin - The Electric sync origin URL
 * @param token - The daemon authentication token
 */
export function createApprovalsCollection(syncOrigin: string, token: string) {
	logger.debug('Initializing approvals electric collection')
	const approvalsElectricCollection = createCollection(
		electricCollectionOptions({
			schema: approvalSelectSchema,
			shapeOptions: {
				url: `${syncOrigin}/v1/daemon/approvals`,
				subsetMethod: 'POST',
				headers: {
					'x-daemon-authorization': token,
				},
				onError: createElectricSyncErrorHandler({
					collectionName: 'approvals',
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
	logger.debug('Approvals electric collection initialized')

	return approvalsElectricCollection
}
