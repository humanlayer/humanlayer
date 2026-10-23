import { diffCommentSelectSchema } from '@humanlayer/db/tables/diff-comments'
import { type CollectionHealthTracker, createBrowserQueryCollection } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryDiffCommentsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'diffComments',
	rowSchema: diffCommentSelectSchema,
	procedure: (apiClient) => {
		const client = apiClient as RiptideApiClient
		return client.sync.v2.diffComments
	},
	bigIntFields: ['created_at', 'updated_at'],
})

export const createQueryDiffCommentsCollection = queryDiffCommentsCollectionBuilder.create
export type QueryDiffCommentsCollection = ReturnType<typeof createQueryDiffCommentsCollection>

export const getQueryDiffCommentsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
) =>
	queryDiffCommentsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion: 2,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryDiffCommentsCollection = (userId: string | null, organizationId: string | null) =>
	queryDiffCommentsCollectionBuilder.destroy(userId, organizationId, 2)
