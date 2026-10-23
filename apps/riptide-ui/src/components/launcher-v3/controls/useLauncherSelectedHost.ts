import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import type { Control } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

import { useSync } from '@/components/providers/SyncProvider'
import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useLocalHostId } from '@/hooks/use-colocated'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { deriveHostState, type HostLaunchTarget } from '@/lib/host-state'
import { useHostStatsClock } from '@/lib/host-stats'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

export function useLauncherSelectedHost(control: Control<LauncherV3FormValues>): HostLaunchTarget | null {
	const hostId = useWatch({ control, name: 'hostId' })
	const { user } = useAuth()
	const { onlineHostsCollection } = useSync()
	const hostQuery = useLiveQuery(
		(q) => {
			if (!user?.id || !hostId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.user_id, user.id), eq(hosts.host_id, hostId)))
				.select(({ hosts }) => ({
					host_name: hosts.host_name,
					status: hosts.status,
					last_seen: hosts.last_seen,
					update_state: hosts.update_state,
				}))
		},
		[onlineHostsCollection, user?.id, hostId],
	)
	const { data: aliases } = useHostAliases()
	const localHostId = useLocalHostId()
	const localPhase = useLocalDaemonLaunchStore((state) => state.phase)
	const nowMs = useHostStatsClock()

	if (!hostId || !hostQuery.isReady) return null
	const row = hostQuery.data?.[0] ?? null
	const isLocal = hostId === localHostId
	return {
		state: deriveHostState({ host: row, isLocal, localPhase, nowMs }),
		registered: row !== null,
		hostLabel:
			aliases?.find((alias) => alias.hostId === hostId)?.displayName ??
			row?.host_name ??
			(isLocal ? 'This device' : hostId.substring(0, 6)),
		isLocal,
	}
}
