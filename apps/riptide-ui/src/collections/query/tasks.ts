import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryTasksCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'tasks',
	rowSchema: taskSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.tasks : client.sync.tasks
	},
	bigIntFields: ['created_at', 'updated_at'],
	indexes: [{ field: (row) => row.updated_at, name: 'updated_at', indexType: BTreeIndex }],
})

export const createQueryTasksCollection = queryTasksCollectionBuilder.create

export type QueryTasksCollection = ReturnType<typeof createQueryTasksCollection>

export const getQueryTasksCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryTasksCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryTasksCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryTasksCollectionBuilder.destroy(userId, organizationId, syncVersion)
