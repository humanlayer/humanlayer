import { taskUserAclSelectSchema } from '@humanlayer/db/tables/task-user-acl'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const taskUserAclsCollectionBuilder = createBrowserElectricCollection({
	schema: taskUserAclSelectSchema,
	routePath: '/task-user-acls',
	collectionName: 'taskUserAcls',
})

export const createTaskUserAclsCollection = taskUserAclsCollectionBuilder.create

export type TaskUserAclsCollection = ReturnType<typeof createTaskUserAclsCollection>

export const getTaskUserAclsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	taskUserAclsCollectionBuilder.get(
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
