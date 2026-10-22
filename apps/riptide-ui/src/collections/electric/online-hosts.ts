import { onlineHostSelectSchema } from '@humanlayer/db/tables/online-hosts'
import { type CollectionHealthTracker, createBrowserElectricCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import { BTreeIndex } from '@tanstack/db'

import { VITE_PUBLIC_SYNC_ORIGIN } from '@/collections/config'
import { getOnlineHostKey } from '@/collections/online-host-key'
import { logger } from '@/lib/logger'

const onlineHostsCollectionBuilder = createBrowserElectricCollection({
	schema: onlineHostSelectSchema,
	routePath: '/hosts',
	routeVersion: 3,
	collectionName: 'onlineHosts',
	indexes: [{ field: (row) => row.host_id, name: 'host_id', indexType: BTreeIndex }],
	getKey: getOnlineHostKey,
})

export const createOnlineHostsCollection = onlineHostsCollectionBuilder.create

export type OnlineHostsCollection = ReturnType<typeof createOnlineHostsCollection>

export const getOnlineHostsCollection = (
	userId: string | null,
	organizationId: string | null,
	tokenFetcher: () => Promise<string>,
	isLoading: boolean,
	tracker: CollectionHealthTracker,
	syncVersion: SyncVersion = 2,
) =>
	onlineHostsCollectionBuilder.get(
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
