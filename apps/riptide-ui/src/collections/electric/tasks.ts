import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const tasksCollectionBuilder = createBrowserElectricCollection({
	schema: taskSelectSchema,
	routePath: '/tasks',
	collectionName: 'tasks',
	indexes: [{ field: (row) => row.updated_at, name: 'updated_at', indexType: BTreeIndex }],
})

export const createTasksCollection = tasksCollectionBuilder.create

export type TasksCollection = ReturnType<typeof createTasksCollection>

export const getTasksCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	tasksCollectionBuilder.get(
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
