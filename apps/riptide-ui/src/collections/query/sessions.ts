import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex, BTreeIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const querySessionsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'sessions',
	rowSchema: sessionSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.sessions : client.sync.sessions
	},
	bigIntFields: [
		'created_at',
		'updated_at',
		'last_activity_at',
		'multiplayer_prompting_started_at',
		'multiplayer_prompting_expires_at',
	],
	indexes: [
		{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex },
		{ field: (row) => row.resource_owner_user_id, name: 'resource_owner_user_id', indexType: BasicIndex },
		{ field: (row) => row.last_activity_at, name: 'last_activity_at', indexType: BTreeIndex },
		{ field: (row) => row.updated_at, name: 'updated_at', indexType: BTreeIndex },
	],
})

export const createQuerySessionsCollection = querySessionsCollectionBuilder.create

export type QuerySessionsCollection = ReturnType<typeof createQuerySessionsCollection>

export const getQuerySessionsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
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
