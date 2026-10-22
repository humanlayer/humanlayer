import { taskOrganizationAclSelectSchema } from '@humanlayer/db/tables/task-organization-acl'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryTaskOrganizationAclsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'taskOrganizationAcls',
	rowSchema: taskOrganizationAclSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.taskOrganizationAcls : client.sync.taskOrganizationAcls
	},
	bigIntFields: ['created_at'],
})

export const createQueryTaskOrganizationAclsCollection = queryTaskOrganizationAclsCollectionBuilder.create

export type QueryTaskOrganizationAclsCollection = ReturnType<typeof createQueryTaskOrganizationAclsCollection>

export const getQueryTaskOrganizationAclsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryTaskOrganizationAclsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryTaskOrganizationAclsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryTaskOrganizationAclsCollectionBuilder.destroy(userId, organizationId, syncVersion)
