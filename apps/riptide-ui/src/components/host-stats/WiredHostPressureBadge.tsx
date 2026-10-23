import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { getHostPressure, useHostStatsClock } from '@/lib/host-stats'

import { HostPressureBadge } from './HostPressureBadge'

export function WiredHostPressureBadge({ hostId, hostName }: { hostId: string; hostName: string }) {
	const { onlineHostsCollection } = useSync()
	const hostQuery = useLiveQuery(
		(q) =>
			q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.host_id, hostId))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					machine: hosts.machine,
					stats: hosts.stats,
					status: hosts.status,
				})),
		[onlineHostsCollection, hostId],
	)

	const nowMs = useHostStatsClock()
	const hostStatsEnabled = useSettingsStore((state) => state.hostStatsEnabled)

	const host = hostQuery.data?.[0]
	if (!hostStatsEnabled || !host || host.status !== 'online') return null
	const pressure = getHostPressure(host.stats, host.machine, nowMs)
	if (!pressure) return null

	return <HostPressureBadge hostName={hostName} pressure={pressure} />
}
