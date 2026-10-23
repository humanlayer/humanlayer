import type { ProviderLoginProvider } from '@humanlayer/db/tables/provider-login-requests'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { type AgentAuthHost, createCodingAgentAuthService, resolveAgentAuth } from '@/services/coding-agent-auth'

export function useCodingAgentAuthService() {
	const { providerLoginRequestsCollection } = useSync()
	return useMemo(
		() =>
			createCodingAgentAuthService({
				requests: () => providerLoginRequestsCollection.toArray,
				connections: () => useAgentConnectionsStore.getState().agentConnections,
			}),
		[providerLoginRequestsCollection],
	)
}

export function useCodingAgentAuth(host: AgentAuthHost | null, provider: ProviderLoginProvider) {
	const { providerLoginRequestsCollection } = useSync()
	const connections = useAgentConnectionsStore((state) => state.agentConnections)
	const hostId = host?.id ?? null
	const rows = useLiveQuery(
		(q) => {
			if (!hostId) return undefined
			return q
				.from({ requests: providerLoginRequestsCollection })
				.where(({ requests }) => eq(requests.host_id, hostId))
		},
		[hostId, providerLoginRequestsCollection],
	)
	const state = host ? resolveAgentAuth(host, provider, rows.data ?? [], connections) : 'unknown'
	return { state, isSignedIn: state !== 'unknown' }
}
