import { artifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { ApiClient } from '@/api/client'

const queryArtifactsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'artifacts',
	rowSchema: artifactSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as ApiClient
		return syncVersion === 2 ? client.client.sync.v2.artifacts : client.client.sync.artifacts
	},
	bigIntFields: ['created_at', 'last_updated_at', 'file_size_bytes'],
	indexes: [{ field: (row) => row.last_updated_at, name: 'last_updated_at', indexType: BTreeIndex }],
})

export const createQueryArtifactsCollection = queryArtifactsCollectionBuilder.create

export type QueryArtifactsCollection = ReturnType<typeof createQueryArtifactsCollection>

export const getQueryArtifactsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: ApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryArtifactsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryArtifactsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryArtifactsCollectionBuilder.destroy(userId, organizationId, syncVersion)
