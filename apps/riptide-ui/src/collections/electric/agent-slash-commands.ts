import { agentSlashCommandsSelectSchema } from '@humanlayer/db/tables/agent-slash-commands'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'

import { getAgentSlashCommandsKey } from '@/collections/agent-slash-commands-key'
import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { logger } from '@/lib/logger'

const agentSlashCommandsCollectionBuilder = createBrowserElectricCollection({
	schema: agentSlashCommandsSelectSchema,
	routePath: '/agent-slash-commands',
	routeVersion: 3,
	collectionName: 'agentSlashCommands',
	indexes: [{ field: (row) => row.host_id, name: 'host_id', indexType: BTreeIndex }],
	getKey: getAgentSlashCommandsKey,
})

export const createAgentSlashCommandsCollection = agentSlashCommandsCollectionBuilder.create

export type AgentSlashCommandsCollection = ReturnType<typeof createAgentSlashCommandsCollection>

export const getAgentSlashCommandsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	agentSlashCommandsCollectionBuilder.get(
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
