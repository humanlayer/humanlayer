import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex } from '@tanstack/db'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const approvalsCollectionBuilder = createBrowserElectricCollection({
	schema: approvalSelectSchema,
	routePath: '/approvals',
	collectionName: 'approvals',
	indexes: [
		{ field: (row) => row.session_id, name: 'session_id', indexType: BasicIndex },
		{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex },
	],
})

export const createApprovalsCollection = approvalsCollectionBuilder.create

export type ApprovalsCollection = ReturnType<typeof createApprovalsCollection>

export const getApprovalsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	approvalsCollectionBuilder.get(
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
