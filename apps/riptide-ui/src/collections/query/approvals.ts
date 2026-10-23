import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryApprovalsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'approvals',
	rowSchema: approvalSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.approvals : client.sync.approvals
	},
	bigIntFields: ['created_at', 'updated_at', 'responded_at'],
	indexes: [
		{ field: (row) => row.session_id, name: 'session_id', indexType: BasicIndex },
		{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex },
	],
})

export const createQueryApprovalsCollection = queryApprovalsCollectionBuilder.create

export type QueryApprovalsCollection = ReturnType<typeof createQueryApprovalsCollection>

export const getQueryApprovalsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryApprovalsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryApprovalsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryApprovalsCollectionBuilder.destroy(userId, organizationId, syncVersion)
