import { Button } from '@humanlayer/ui/components/button'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { HostPressureNotice } from '@/components/host-stats/HostStatsMeters'
import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useHostAliases } from '@/hooks/use-host-aliases'
import {
	formatGb,
	formatProcessGroupName,
	formatRunningSessions,
	getHostPressure,
	heaviestByMemory,
	useHostStatsClock,
} from '@/lib/host-stats'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

export function LauncherHostPressureNoticeWired({ control }: { control: Control<LauncherV3FormValues> }) {
	const { field: hostId } = useController({ control, name: 'hostId' })
	const { user } = useAuth()
	const { onlineHostsCollection } = useSync()
	const { data: aliases } = useHostAliases()
	const hostsQuery = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					host_name: hosts.host_name,
					status: hosts.status,
					machine: hosts.machine,
					stats: hosts.stats,
				}))
		},
		[onlineHostsCollection, user?.id],
	)

	const nameFor = useMemo(
		() => (id: string) =>
			aliases?.find((alias) => alias.hostId === id)?.displayName ??
			hostsQuery.data?.find((host) => host.host_id === id)?.host_name ??
			id.substring(0, 6),
		[aliases, hostsQuery.data],
	)

	const nowMs = useHostStatsClock()
	const hostStatsEnabled = useSettingsStore((state) => state.hostStatsEnabled)

	const selectedId = hostId.value
	if (!hostStatsEnabled || !selectedId) return null
	const selected = hostsQuery.data?.find((host) => host.host_id === selectedId)
	if (!selected) return null
	const pressure = getHostPressure(selected.stats, selected.machine, nowMs)
	if (!pressure || pressure.memLevel === 'ok') return null

	const alternative = (hostsQuery.data ?? [])
		.flatMap((host) => {
			if (host.host_id === selectedId || host.status !== 'online') return []
			const candidate = getHostPressure(host.stats, host.machine, nowMs)
			return candidate && candidate.memLevel === 'ok' ? [{ id: host.host_id, memPct: candidate.memPct }] : []
		})
		.sort((a, b) => a.memPct - b.memPct)[0]
	const heaviest = heaviestByMemory(pressure.topProcesses)
	const heaviestDetail = heaviest
		? ` Most memory: ${formatProcessGroupName(heaviest)}, ${formatGb(heaviest.memBytes)}.`
		: ''

	return (
		<HostPressureNotice
			level={pressure.memLevel}
			title={`${nameFor(selectedId)} is low on memory`}
			detail={`${pressure.memPct}% of memory used · ${formatRunningSessions(pressure.sessionCount)}. A new session here may run slowly or fail to start.${heaviestDetail}`}
			actions={
				alternative ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-6 rounded-none font-mono text-[10px] uppercase tracking-wider"
						onClick={() => hostId.onChange(alternative.id)}
					>
						Use {nameFor(alternative.id)} instead
					</Button>
				) : null
			}
		/>
	)
}
