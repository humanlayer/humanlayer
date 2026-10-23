import { queuedMessageSelectSchema } from '@humanlayer/db/tables/queued-messages'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex, BTreeIndex } from '@tanstack/db'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const queuedMessagesCollectionBuilder = createBrowserElectricCollection({
	schema: queuedMessageSelectSchema,
	routePath: '/queued-messages',
	collectionName: 'queuedMessages',
	indexes: [
		{ field: (row) => row.session_id, name: 'session_id', indexType: BasicIndex },
		{ field: (row) => row.created_at, name: 'created_at', indexType: BTreeIndex },
	],
})

export const createQueuedMessagesCollection = queuedMessagesCollectionBuilder.create

export type QueuedMessagesCollection = ReturnType<typeof createQueuedMessagesCollection>

export const getQueuedMessagesCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	queuedMessagesCollectionBuilder.get(
		userId,
		organizationId,
		{
			syncOrigin: VITE_PUBLIC_SYNC_ORIGIN,
			tokenFetcher,
			shouldRetryOnFailure: !isLoading,
			tracker,
			syncVersion,
			logger,
			captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		},
		isLoading,
	)
