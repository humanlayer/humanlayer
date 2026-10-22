import { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BasicIndex } from '@tanstack/db'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const conversationEventsCollectionBuilder = createBrowserElectricCollection({
	schema: conversationEventSelectSchema,
	routePath: '/events',
	collectionName: 'conversationEvents',
	indexes: [
		{ field: (row) => row.session_id, name: 'session_id', indexType: BasicIndex },
		{ field: (row) => row.task_id, name: 'task_id', indexType: BasicIndex },
	],
})

export const createConversationEventsCollection = conversationEventsCollectionBuilder.create
export const createEventsCollection = createConversationEventsCollection

export type ConversationEventsCollection = ReturnType<typeof createConversationEventsCollection>
export type EventsCollection = ConversationEventsCollection

export const getConversationEventsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	conversationEventsCollectionBuilder.get(
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

export const getEventsCollection = getConversationEventsCollection
