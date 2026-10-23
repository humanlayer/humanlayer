import type {
	ProviderLoginProvider,
	ProviderLoginStatus,
	providerLoginRequestSelectSchema,
} from '@humanlayer/db/tables/provider-login-requests'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type z from 'zod/v4'

import type { AgentConnection } from '@/hooks/stores/agentConnectionsStore'

export type ProviderLoginRow = z.output<typeof providerLoginRequestSelectSchema>
export type AgentAuthHost = { readonly id: string; readonly isColocated: boolean }
export type AgentAuthState = 'local-ready' | 'sign-in-succeeded' | 'unknown'

export function hasProviderSignIn(status: ProviderLoginStatus | null, localReady = false): boolean {
	return localReady || status === 'succeeded'
}

export function latestProviderLogins(rows: ReadonlyArray<ProviderLoginRow>, hostId: string | null) {
	const latest = new Map<ProviderLoginProvider, ProviderLoginRow>()
	for (const row of rows) {
		if (row.host_id !== hostId) continue
		const current = latest.get(row.provider)
		if (!current || row.created_at > current.created_at) latest.set(row.provider, row)
	}
	return latest
}

export function resolveAgentAuth(
	host: AgentAuthHost,
	provider: ProviderLoginProvider,
	rows: ReadonlyArray<ProviderLoginRow>,
	connections: readonly AgentConnection[],
	harness: CodingAgent = 'codelayer',
): AgentAuthState {
	if (
		host.isColocated &&
		(harness === 'codelayer' || harness === 'claude') &&
		connections.some((connection) => connection.agent === provider && connection.status === 'ready')
	)
		return 'local-ready'
	return hasProviderSignIn(latestProviderLogins(rows, host.id).get(provider)?.status ?? null)
		? 'sign-in-succeeded'
		: 'unknown'
}

export function createCodingAgentAuthService(sources: {
	readonly requests: () => ReadonlyArray<ProviderLoginRow>
	readonly connections: () => readonly AgentConnection[]
}) {
	return {
		getState: (host: AgentAuthHost, provider: ProviderLoginProvider, harness?: CodingAgent) =>
			resolveAgentAuth(host, provider, sources.requests(), sources.connections(), harness),
	}
}
