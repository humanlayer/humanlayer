import { artifactMetadataSelectSchema } from '@humanlayer/db/tables/artifacts'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { ApiClient } from '@/api/client'

const queryArtifactsMetadataCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'artifactsMetadata',
	rowSchema: artifactMetadataSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as ApiClient
		return syncVersion === 2 ? client.client.sync.v2.artifactsMetadata : client.client.sync.artifactsMetadata
	},
	bigIntFields: ['created_at', 'last_updated_at', 'file_size_bytes'],
})

export const createQueryArtifactsMetadataCollection = queryArtifactsMetadataCollectionBuilder.create

export type QueryArtifactsMetadataCollection = ReturnType<typeof createQueryArtifactsMetadataCollection>

export const getQueryArtifactsMetadataCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: ApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryArtifactsMetadataCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryArtifactsMetadataCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryArtifactsMetadataCollectionBuilder.destroy(userId, organizationId, syncVersion)
