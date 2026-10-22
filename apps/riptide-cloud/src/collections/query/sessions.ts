import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { ApiClient } from '@/api/client'

const querySessionsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'sessions',
	rowSchema: sessionSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as ApiClient
		return syncVersion === 2 ? client.client.sync.v2.sessions : client.client.sync.sessions
	},
	bigIntFields: [
		'created_at',
		'updated_at',
		'last_activity_at',
		'multiplayer_prompting_started_at',
		'multiplayer_prompting_expires_at',
	],
})

export const createQuerySessionsCollection = querySessionsCollectionBuilder.create

export type QuerySessionsCollection = ReturnType<typeof createQuerySessionsCollection>

export const getQuerySessionsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: ApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	querySessionsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQuerySessionsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => querySessionsCollectionBuilder.destroy(userId, organizationId, syncVersion)
