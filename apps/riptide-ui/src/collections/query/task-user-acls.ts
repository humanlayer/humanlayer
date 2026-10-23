import { taskUserAclSelectSchema } from '@humanlayer/db/tables/task-user-acl'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryTaskUserAclsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'taskUserAcls',
	rowSchema: taskUserAclSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.taskUserAcls : client.sync.taskUserAcls
	},
	bigIntFields: ['created_at'],
})

export const createQueryTaskUserAclsCollection = queryTaskUserAclsCollectionBuilder.create

export type QueryTaskUserAclsCollection = ReturnType<typeof createQueryTaskUserAclsCollection>

export const getQueryTaskUserAclsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryTaskUserAclsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryTaskUserAclsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryTaskUserAclsCollectionBuilder.destroy(userId, organizationId, syncVersion)
