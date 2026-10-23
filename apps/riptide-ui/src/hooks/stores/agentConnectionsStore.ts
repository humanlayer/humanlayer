import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { AgentProbeResult, CodingAgent } from '@/integrations/desktop/diagnostics'

export const AGENT_CONNECTIONS_STORAGE_KEY = 'riptide-agent-connections'
export const AGENT_CONNECTIONS_STORE_VERSION = 4

export interface UncheckedAgentConnection {
	readonly status: 'not_checked'
	readonly agent: CodingAgent
	readonly path: null
	readonly version: null
	readonly installationSource: null
	readonly checkedAt: null
}

export type AgentConnection = UncheckedAgentConnection | AgentProbeResult

interface AgentConnectionsState {
	agentConnections: [AgentConnection, ...AgentConnection[]]
	skippedOptionalAgents: CodingAgent[]
	dismissedInstallationAdvice: Partial<Record<CodingAgent, string>>
	lastVerifiedClaudePath: string | null
	recordProbeResult: (result: AgentProbeResult) => void
	skipOptionalAgent: (agent: CodingAgent) => void
	dismissInstallationAdvice: (agent: CodingAgent, source: string) => void
}

const uncheckedConnection = (agent: CodingAgent): UncheckedAgentConnection => ({
	status: 'not_checked',
	agent,
	path: null,
	version: null,
	installationSource: null,
	checkedAt: null,
})

function isCodingAgent(value: unknown): value is CodingAgent {
	return value === 'claude' || value === 'codex'
}

function isAgentConnection(value: unknown): value is AgentConnection {
	if (!value || typeof value !== 'object') return false
	const candidate = value as Record<string, unknown>
	if (!isCodingAgent(candidate.agent)) return false
	if (candidate.status === 'not_checked') return true
	if (candidate.status === 'ready') {
		return (
			typeof candidate.path === 'string' &&
			typeof candidate.version === 'string' &&
			typeof candidate.installationSource === 'string' &&
			typeof candidate.checkedAt === 'number'
		)
	}
	return (
		candidate.status === 'failed' &&
		typeof candidate.checkedAt === 'number' &&
		typeof candidate.failure === 'object'
	)
}

function normalizeConnection(value: unknown): AgentConnection | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Record<string, unknown>
	if (candidate.status === 'checking' && isCodingAgent(candidate.agent)) {
		return uncheckedConnection(candidate.agent)
	}
	return isAgentConnection(value) ? value : null
}

function normalizeConnections(value: unknown): [AgentConnection, ...AgentConnection[]] {
	const connections = Array.isArray(value)
		? value.map(normalizeConnection).filter((connection): connection is AgentConnection => connection !== null)
		: []
	return connections.length > 0
		? (connections as [AgentConnection, ...AgentConnection[]])
		: [uncheckedConnection('claude')]
}

export function migrateAgentConnectionsStore(
	persistedState: unknown,
	persistedVersion = AGENT_CONNECTIONS_STORE_VERSION,
): Pick<
	AgentConnectionsState,
	'agentConnections' | 'skippedOptionalAgents' | 'dismissedInstallationAdvice' | 'lastVerifiedClaudePath'
> {
	if (!persistedState || typeof persistedState !== 'object') {
		return {
			agentConnections: [uncheckedConnection('claude')],
			skippedOptionalAgents: [],
			dismissedInstallationAdvice: {},
			lastVerifiedClaudePath: null,
		}
	}

	const state = persistedState as Record<string, unknown>
	const skippedOptionalAgents = Array.isArray(state.skippedOptionalAgents)
		? state.skippedOptionalAgents.filter(isCodingAgent)
		: []
	const dismissedInstallationAdvice =
		state.dismissedInstallationAdvice && typeof state.dismissedInstallationAdvice === 'object'
			? (state.dismissedInstallationAdvice as Partial<Record<CodingAgent, string>>)
			: {}
	const agentConnections = normalizeConnections(state.agentConnections).map((connection) =>
		persistedVersion < 4 && connection.agent === 'codex' ? uncheckedConnection('codex') : connection,
	) as [AgentConnection, ...AgentConnection[]]
	const lastVerifiedClaudePath =
		typeof state.lastVerifiedClaudePath === 'string' ? state.lastVerifiedClaudePath : null
	return {
		agentConnections,
		skippedOptionalAgents,
		dismissedInstallationAdvice,
		lastVerifiedClaudePath,
	}
}

function replaceConnection(
	connections: [AgentConnection, ...AgentConnection[]],
	connection: AgentConnection,
): [AgentConnection, ...AgentConnection[]] {
	const existingIndex = connections.findIndex(({ agent }) => agent === connection.agent)
	if (existingIndex === -1) return [...connections, connection]
	return connections.map((current, index) => (index === existingIndex ? connection : current)) as [
		AgentConnection,
		...AgentConnection[],
	]
}

export const useAgentConnectionsStore = create<AgentConnectionsState>()(
	persist(
		(set) => ({
			agentConnections: [uncheckedConnection('claude')],
			skippedOptionalAgents: [],
			dismissedInstallationAdvice: {},
			lastVerifiedClaudePath: null,
			recordProbeResult: (result) =>
				set((state) => ({
					agentConnections: replaceConnection(state.agentConnections, result),
					skippedOptionalAgents: state.skippedOptionalAgents.filter(
						(candidate) => candidate !== result.agent,
					),
					lastVerifiedClaudePath:
						result.agent === 'claude' && result.status === 'ready'
							? result.path
							: state.lastVerifiedClaudePath,
				})),
			skipOptionalAgent: (agent) =>
				set((state) => ({
					skippedOptionalAgents: state.skippedOptionalAgents.includes(agent)
						? state.skippedOptionalAgents
						: [...state.skippedOptionalAgents, agent],
				})),
			dismissInstallationAdvice: (agent, source) =>
				set((state) => ({
					dismissedInstallationAdvice: { ...state.dismissedInstallationAdvice, [agent]: source },
				})),
		}),
		{
			name: AGENT_CONNECTIONS_STORAGE_KEY,
			version: AGENT_CONNECTIONS_STORE_VERSION,
			migrate: (persistedState, persistedVersion) =>
				migrateAgentConnectionsStore(persistedState, persistedVersion),
			partialize: (state) => ({
				agentConnections: state.agentConnections,
				skippedOptionalAgents: state.skippedOptionalAgents,
				dismissedInstallationAdvice: state.dismissedInstallationAdvice,
				lastVerifiedClaudePath: state.lastVerifiedClaudePath,
			}),
		},
	),
)
