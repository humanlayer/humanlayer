import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { env } from '@/env'
import { logger } from '@/utils/logger'

const sessionsCollectionBuilder = createBrowserElectricCollection({
	schema: sessionSelectSchema,
	routePath: '/sessions',
	collectionName: 'sessions',
})

export const createSessionsCollection = sessionsCollectionBuilder.create

export type SessionsCollection = ReturnType<typeof createSessionsCollection>

export const getSessionsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	sessionsCollectionBuilder.get(
		userId,
		organizationId,
		{
			syncOrigin: env.VITE_PUBLIC_SYNC_ORIGIN,
			tokenFetcher,
			shouldRetryOnFailure: !isLoading,
			tracker,
			syncVersion,
			logger,
			captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		},
		isLoading,
	)
