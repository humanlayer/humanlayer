import { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const queryConversationEventsCollectionBuilder = createBrowserQueryCollection({
	collectionName: 'conversationEvents',
	rowSchema: conversationEventSelectSchema,
	procedure: (apiClient, syncVersion) => {
		const client = apiClient as RiptideApiClient
		return syncVersion === 2 ? client.sync.v2.conversationEvents : client.sync.conversationEvents
	},
	bigIntFields: ['created_at', 'updated_at'],
	indexes: [
		{ field: (row) => row.session_id, name: 'session_id', indexType: BasicIndex },
		{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex },
	],
})

export const createQueryConversationEventsCollection = queryConversationEventsCollectionBuilder.create
export const createQueryEventsCollection = createQueryConversationEventsCollection

export type QueryConversationEventsCollection = ReturnType<typeof createQueryConversationEventsCollection>
export type QueryEventsCollection = QueryConversationEventsCollection

export const getQueryConversationEventsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	queryConversationEventsCollectionBuilder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})

export const destroyQueryConversationEventsCollection = (
	userId: string | null,
	organizationId: string | null,
	syncVersion: SyncVersion = 2,
) => queryConversationEventsCollectionBuilder.destroy(userId, organizationId, syncVersion)

export const getQueryEventsCollection = getQueryConversationEventsCollection
export const destroyQueryEventsCollection = destroyQueryConversationEventsCollection
