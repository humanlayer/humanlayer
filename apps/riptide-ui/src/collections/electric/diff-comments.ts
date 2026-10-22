import { diffCommentSelectSchema } from '@humanlayer/db/tables/diff-comments'
import { type CollectionHealthTracker, createBrowserElectricCollection } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const diffCommentsCollectionBuilder = createBrowserElectricCollection({
	schema: diffCommentSelectSchema,
	routePath: '/diff-comments',
	collectionName: 'diffComments',
})

export const createDiffCommentsCollection = diffCommentsCollectionBuilder.create
export type DiffCommentsCollection = ReturnType<typeof createDiffCommentsCollection>

export const getDiffCommentsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
) =>
	diffCommentsCollectionBuilder.get(
		userId,
		organizationId,
		{
			syncOrigin: VITE_PUBLIC_SYNC_ORIGIN,
			tokenFetcher,
			shouldRetryOnFailure: !isLoading,
			tracker,
			syncVersion: 2,
			logger,
			captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		},
		isLoading,
	)
