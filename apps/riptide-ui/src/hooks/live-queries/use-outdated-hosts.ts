import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync } from '@/components/providers/SyncProvider'
import { useTargetDaemonVersion } from '@/hooks/use-target-daemon-version'
import { getHostUpdateState, hasOldSelfUpdater, isHostUpdatable } from '@/lib/host-update'

export type OutdatedHost = {
	hostId: string
	hostName: string | null
	daemonVersion: string | null
	isUpdatable: boolean
	hasOldSelfUpdater: boolean
	runningSessionCount: number
}

export function useOutdatedHosts(): {
	outdatedHosts: OutdatedHost[]
	targetDaemonVersion: string | null
	isReady: boolean
} {
	const { onlineHostsCollection } = useSync()
	const { user } = useAuth()
	const { targetDaemonVersion } = useTargetDaemonVersion()

	const { data, isReady: hostsReady } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					host_name: hosts.host_name,
					daemon_version: hosts.daemon_version,
					distribution: hosts.distribution,
					can_self_update: hosts.can_self_update,
					capabilities: hosts.capabilities,
					update_state: hosts.update_state,
					stats: hosts.stats,
				}))
		},
		[onlineHostsCollection, user?.id],
	)

	const outdatedHosts = (data ?? [])
		.filter((host) => getHostUpdateState(host, targetDaemonVersion) === 'outdated')
		.map((host) => ({
			hostId: host.host_id,
			hostName: host.host_name,
			daemonVersion: host.daemon_version,
			isUpdatable: isHostUpdatable(host),
			hasOldSelfUpdater: hasOldSelfUpdater(host),
			runningSessionCount: host.stats?.sessionCount ?? 0,
		}))

	return { outdatedHosts, targetDaemonVersion, isReady: hostsReady }
}
