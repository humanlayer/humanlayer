import { agentCommandDiscoveryRequestSelectSchema } from '@humanlayer/db/tables/agent-command-discovery-requests'
import { createElectricCollection } from '@humanlayer/sync'

import { Sentry } from '@/instrument'
import logger from '@/logger'

export type AgentCommandDiscoveryRequestsCollection = ReturnType<typeof createAgentCommandDiscoveryRequestsCollection>
export function createAgentCommandDiscoveryRequestsCollection(syncOrigin: string, token: string) {
	return createElectricCollection({
		schema: agentCommandDiscoveryRequestSelectSchema,
		collectionName: 'agentCommandDiscoveryRequests',
		syncOrigin,
		syncVersion: 2,
		routePath: '/daemon/agent-command-discovery-requests',
		headers: { 'x-daemon-authorization': token },
		shouldRetryOnFailure: true,
		logger,
		captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
		getKey: (item) => JSON.stringify([item.user_id, item.agent]),
	})
}
