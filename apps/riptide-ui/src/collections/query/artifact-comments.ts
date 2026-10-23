import { artifactCommentSelectSchema } from '@humanlayer/db/tables/artifact-comments'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryArtifactCommentsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'artifactComments',
	rowSchema: artifactCommentSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.artifactComments : client.sync.artifactComments
	},
	bigIntFields: ['created_at', 'updated_at'],
})

export const createQueryArtifactCommentsCollection = queryArtifactCommentsCollectionBuilder.create

export type QueryArtifactCommentsCollection = ReturnType<typeof createQueryArtifactCommentsCollection>

export const getQueryArtifactCommentsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryArtifactCommentsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryArtifactCommentsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryArtifactCommentsCollectionBuilder.destroy(userId, organizationId, syncVersion)
