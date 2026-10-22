import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'
import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useIsColocated } from '@/hooks/use-colocated'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { useHostStatsClock } from '@/lib/host-stats'
import { getSessionHostRegistrationIdentity, type SessionHostIdentitySource } from '@/lib/session-host-identity'
import { deriveSessionHostState, type SessionHostState } from '@/lib/session-host-state'

export interface SessionHostSnapshot {
	state: SessionHostState | null
	isLocal: boolean
	hostLabel: string | null
	shortHostId: string | null
}

export function useSessionHostState(session: SessionHostIdentitySource | undefined): SessionHostSnapshot {
	const { onlineHostsCollection } = useSync()
	const nowMs = useHostStatsClock()
	const localPhase = useLocalDaemonLaunchStore((state) => state.phase)
	const { data: aliases } = useHostAliases()
	const identity = getSessionHostRegistrationIdentity(session)
	const hostId = identity?.hostId
	const organizationId = identity?.organizationId
	const userId = identity?.userId
	const { isColocated: isLocal } = useIsColocated(hostId)

	const result = useLiveQuery(
		(q) => {
			if (!hostId || !organizationId || !userId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.select(({ hosts }) => ({
					host_name: hosts.host_name,
					status: hosts.status,
					last_seen: hosts.last_seen,
					update_state: hosts.update_state,
				}))
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

	if (!hostId) return { state: null, isLocal, hostLabel: null, shortHostId: null }

	const row = result.data?.[0] ?? null
	const shortHostId = hostId.substring(0, 6)
	const hostLabel = aliases?.find((alias) => alias.hostId === hostId)?.displayName ?? row?.host_name ?? shortHostId
	const state = identity && result.isReady ? deriveSessionHostState({ host: row, isLocal, localPhase, nowMs }) : null
	return { state, isLocal, hostLabel, shortHostId }
}
