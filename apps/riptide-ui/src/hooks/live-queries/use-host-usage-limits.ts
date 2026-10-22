import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { type ClaudeUsageLimits, usageLimitsForAgent } from '@humanlayer/schemas/zod/host/usage-limits'
import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

interface HostRegistrationIdentity {
	hostId: string
	organizationId: string
	userId: string
}

export function useHostUsageLimits(
	identity: HostRegistrationIdentity | undefined | null,
	codingAgent: CodingAgent | null | undefined,
): ClaudeUsageLimits | null {
	const { onlineHostsCollection } = useSync()
	const hostId = identity?.hostId
	const organizationId = identity?.organizationId
	const userId = identity?.userId

	const result = useLiveQuery(
		(q) => {
			if (!hostId || !organizationId || !userId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.select(({ hosts }) => ({ coding_agent_usage_limits: hosts.coding_agent_usage_limits }))
				.where(({ hosts }) =>
					and(
						eq(hosts.host_id, hostId),
						eq(hosts.organization_id, organizationId),
						eq(hosts.user_id, userId),
					),
				)
		},
		[onlineHostsCollection, hostId, organizationId, userId],
	)

	return usageLimitsForAgent(codingAgent, result.data?.[0]?.coding_agent_usage_limits)
}
