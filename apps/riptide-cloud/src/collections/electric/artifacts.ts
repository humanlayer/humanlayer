import { artifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'

import { env } from '@/env'
import { logger } from '@/utils/logger'

const artifactsCollectionBuilder = createBrowserElectricCollection({
	schema: artifactSelectSchema,
	routePath: '/artifacts',
	collectionName: 'artifacts',
	indexes: [{ field: (row) => row.last_updated_at, name: 'last_updated_at', indexType: BTreeIndex }],
})

export const createArtifactsCollection = artifactsCollectionBuilder.create

export type ArtifactsCollection = ReturnType<typeof createArtifactsCollection>

export const getArtifactsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	artifactsCollectionBuilder.get(
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
