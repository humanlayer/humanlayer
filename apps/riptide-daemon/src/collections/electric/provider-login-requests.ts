import { providerLoginRequestSelectSchema } from '@humanlayer/db/tables/provider-login-requests'
import { createElectricCollection } from '@humanlayer/sync'

import { Sentry } from '@/instrument'
import logger from '@/logger'

export type ProviderLoginRequestsCollection = ReturnType<typeof createProviderLoginRequestsCollection>
export function createProviderLoginRequestsCollection(syncOrigin: string, token: string) {
	return createElectricCollection({
		schema: providerLoginRequestSelectSchema,
		collectionName: 'providerLoginRequests',
		syncOrigin,
		syncVersion: 2,
		routePath: '/daemon/provider-login-requests',
		headers: { 'x-daemon-authorization': token },
		shouldRetryOnFailure: true,
		logger,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		getKey: (item) => item.id,
	})
}
