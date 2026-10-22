import { providerLoginRequestSelectSchema } from '@humanlayer/db/tables/provider-login-requests'
import { type CollectionHealthTracker, createBrowserQueryCollection, type SyncVersion } from '@humanlayer/sync'
import * as Sentry from '@sentry/react'
import type { QueryClient } from '@tanstack/query-core'

import type { RiptideApiClient } from '@/orpc/client'

const builder = createBrowserQueryCollection({
	collectionName: 'providerLoginRequests',
	rowSchema: providerLoginRequestSelectSchema,
	procedure: (client) => (client as RiptideApiClient).sync.v2.providerLoginRequests,
	bigIntFields: ['expires_at', 'created_at', 'updated_at'],
})
export const createQueryProviderLoginRequestsCollection = builder.create
export type QueryProviderLoginRequestsCollection = ReturnType<typeof createQueryProviderLoginRequestsCollection>
export const getQueryProviderLoginRequestsCollection = (
	userId: string | null,
	organizationId: string | null,
	apiClient: RiptideApiClient,
	tracker: CollectionHealthTracker,
	queryClient: QueryClient,
	syncVersion: SyncVersion = 2,
) =>
	builder.get(userId, organizationId, {
		apiClient,
		tracker,
		queryClient,
		syncVersion,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
	})
export const destroyQueryProviderLoginRequestsCollection = builder.destroy
