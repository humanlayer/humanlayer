import { artifactCommentSelectSchema } from '@humanlayer/db/tables/artifact-comments'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const artifactCommentsCollectionBuilder = createBrowserElectricCollection({
	schema: artifactCommentSelectSchema,
	routePath: '/artifact-comments',
	collectionName: 'artifactComments',
})

export const createArtifactCommentsCollection = artifactCommentsCollectionBuilder.create

export type ArtifactCommentsCollection = ReturnType<typeof createArtifactCommentsCollection>

export const getArtifactCommentsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	artifactCommentsCollectionBuilder.get(
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
