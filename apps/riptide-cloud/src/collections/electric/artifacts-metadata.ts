import { artifactMetadataSelectSchema } from '@humanlayer/db/tables/artifacts'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'

import { env } from '@/env'
import { logger } from '@/utils/logger'

const artifactsMetadataCollectionBuilder = createBrowserElectricCollection({
	schema: artifactMetadataSelectSchema,
	routePath: '/artifacts/metadata',
	collectionName: 'artifactsMetadata',
})

export const createArtifactsMetadataCollection = artifactsMetadataCollectionBuilder.create

export type ArtifactsMetadataCollection = ReturnType<typeof createArtifactsMetadataCollection>

export const getArtifactsMetadataCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	artifactsMetadataCollectionBuilder.get(
		userId,
		organizationId,
		{
			syncOrigin: env.VITE_PUBLIC_SYNC_ORIGIN,
			tokenFetcher,
			shouldRetryOnFailure: !isLoading,
			tracker,
			syncVersion,
			logger,
			captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		},
		isLoading,
	)
