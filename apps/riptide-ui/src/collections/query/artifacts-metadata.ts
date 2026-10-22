import { artifactMetadataSelectSchema } from '@humanlayer/db/tables/artifacts'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const ARTIFACTS_METADATA_PAGE_SIZE = 10_000

const queryArtifactsMetadataCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'artifactsMetadata',
	rowSchema: artifactMetadataSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.artifactsMetadata : client.sync.artifactsMetadata
	},
	bigIntFields: ['created_at', 'last_updated_at', 'file_size_bytes'],
	indexes: [{ field: (row) => row.last_updated_at, name: 'last_updated_at', indexType: BTreeIndex }],
	pagination: {
		pageSize: ARTIFACTS_METADATA_PAGE_SIZE,
		stableSorts: [{ field: ['id'], direction: 'asc', nulls: 'last' }],
	},
})

export const createQueryArtifactsMetadataCollection = queryArtifactsMetadataCollectionBuilder.create

export type QueryArtifactsMetadataCollection = ReturnType<typeof createQueryArtifactsMetadataCollection>

export const getQueryArtifactsMetadataCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
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
