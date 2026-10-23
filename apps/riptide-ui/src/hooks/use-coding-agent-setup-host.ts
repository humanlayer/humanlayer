import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { CodingAgentSetupHost } from '@/lib/coding-agent-setup'

import { useIsColocated } from './use-colocated'
import { useHostAliases } from './use-host-aliases'

/** Resolves a launcher's selected daemon host into setup-dialog display context. */
export function useCodingAgentSetupHost(hostId: string | null | undefined): CodingAgentSetupHost | null {
	const { user } = useAuth()
	const { onlineHostsCollection } = useSync()
	const { data: aliases } = useHostAliases()
	const { isColocated } = useIsColocated(hostId)
	const hosts = useLiveQuery(
		(q) => {
			if (!hostId || !user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.host_id, hostId), eq(hosts.user_id, user.id)))
				.select(({ hosts }) => ({ host_name: hosts.host_name }))
		},
		[hostId, onlineHostsCollection, user?.id],
	)

	return useMemo(() => {
		if (!hostId) return null
		const name =
			aliases?.find((alias) => alias.hostId === hostId)?.displayName ??
			hosts.data?.[0]?.host_name ??
			hostId.substring(0, 6)
		return { id: hostId, name, isColocated }
	}, [aliases, hostId, hosts.data, isColocated])
}
