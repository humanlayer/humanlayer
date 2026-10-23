import { usageLimitsForAgent } from '@humanlayer/schemas/zod/host/usage-limits'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { useSync } from '@/components/providers/SyncProvider'
import { buildNavigationDeepLink } from '@/domains/deep-links/handler'
import { isLocalDaemonStarting, useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useCodingAgentSetupGuard } from '@/hooks/use-coding-agent-setup-guard'
import { useIsColocated } from '@/hooks/use-colocated'
import { useHostAliases } from '@/hooks/use-host-aliases'
import { isAttachedSessionsOnly } from '@/lib/daemon-version'
import { deriveHostState, sortHostsByState } from '@/lib/host-state'
import { getHostPressure, useHostStatsClock } from '@/lib/host-stats'
import { openCloudUrl } from '@/lib/url-opener'
import { isTauri } from '@/lib/utils'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'
import { getCloudOrigin } from '@/utils/artifact-links'

import { LauncherHostControl, type LauncherHostControlState, type LauncherHostOption } from './LauncherHostControl'

export interface LauncherHostControlWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
}

export function LauncherHostControlWired({ control, disabled }: LauncherHostControlWiredProps) {
	const { field: hostId } = useController({ control, name: 'hostId' })
	const { field: excludedRepositories } = useController({ control, name: 'excludedRepositoryLocalPaths' })
	const { field: defaultRepository } = useController({ control, name: 'defaultLaunchRepositoryLocalPath' })
	const agent = useWatch({ control, name: 'agent' })
	const provider = useWatch({ control, name: 'provider' })
	const { guardSetup } = useCodingAgentSetupGuard()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { onlineHostsCollection } = useSync()
	const hostsQuery = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					host_name: hosts.host_name,
					last_seen: hosts.last_seen,
					status: hosts.status,
					update_state: hosts.update_state,
					machine: hosts.machine,
					stats: hosts.stats,
					coding_agent_usage_limits: hosts.coding_agent_usage_limits,
					capabilities: hosts.capabilities,
				}))
				.orderBy(({ hosts }) => hosts.host_name, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)
	const { data: aliases } = useHostAliases()
	const { localHostId } = useIsColocated(hostId.value)
	const nowMs = useHostStatsClock()
	const hostStatsEnabled = useSettingsStore((state) => state.hostStatsEnabled)
	const localPhase = useLocalDaemonLaunchStore((state) => state.phase)
	const hosts = useMemo(() => {
		const rows = hostsQuery.data ?? []
		const options: LauncherHostOption[] = rows.flatMap((host) =>
			host.host_id && !isAttachedSessionsOnly(host)
				? [
						{
							id: host.host_id,
							label:
								aliases?.find((alias) => alias.hostId === host.host_id)?.displayName ??
								host.host_name ??
								host.host_id.substring(0, 6),
							isLocal: host.host_id === localHostId,
							usageLimits: usageLimitsForAgent(agent, host.coding_agent_usage_limits),
							state: deriveHostState({ host, isLocal: host.host_id === localHostId, localPhase, nowMs }),
							registered: true,
							recommended: false,
							pressure: hostStatsEnabled ? getHostPressure(host.stats, host.machine, nowMs) : null,
						},
					]
				: [],
		)
		if (localHostId && isLocalDaemonStarting(localPhase) && !rows.some((host) => host.host_id === localHostId)) {
			options.push({
				id: localHostId,
				label: 'This device',
				isLocal: true,
				state: 'starting',
				registered: false,
			})
		}
		const measured = options.filter((option) => option.state === 'online' && option.pressure)
		const leastPressured =
			measured.length > 1
				? measured.reduce((best, option) =>
						(option.pressure?.memPct ?? 100) < (best.pressure?.memPct ?? 100) ? option : best,
					)
				: undefined
		return sortHostsByState(options.map((option) => ({ ...option, recommended: option.id === leastPressured?.id })))
	}, [agent, aliases, hostStatsEnabled, hostsQuery.data, localHostId, localPhase, nowMs])

	let state: LauncherHostControlState
	if (!hostsQuery.isReady) state = { status: 'loading' }
	else if (hosts.length === 0) state = { status: 'empty' }
	else state = { status: 'available', hosts }

	const commitHostSelection = (nextHostId: string) => {
		if (!hosts.some(({ id }) => id === nextHostId)) return
		excludedRepositories.onChange([])
		defaultRepository.onChange(null)
		hostId.onChange(nextHostId)
	}

	const selectHost = (nextHostId: string) => {
		const nextHost = hosts.find(({ id }) => id === nextHostId)
		if (!nextHost || (agent !== 'codelayer' && agent !== 'fold')) {
			commitHostSelection(nextHostId)
			return
		}
		guardSetup({
			agent,
			provider,
			host: { id: nextHost.id, name: nextHost.label, isColocated: nextHost.isLocal },
			onContinue: () => commitHostSelection(nextHostId),
		})
	}

	return (
		<LauncherHostControl
			state={state}
			selectedHostId={hostId.value}
			isDesktopApp={isTauri()}
			disabled={disabled}
			onSelectHost={selectHost}
			onOpenDaemonSettings={() => navigate({ to: '/settings/daemons' })}
			onLaunchDesktopApp={() => {
				window.location.href = buildNavigationDeepLink('/tasks/new')
			}}
			onDownloadDesktopApp={() => {
				const cloudOrigin = getCloudOrigin()
				if (!cloudOrigin) return openCloudUrl(undefined)
				window.open(`${cloudOrigin}/install`, '_blank', 'noopener')
			}}
			onBlur={hostId.onBlur}
		/>
	)
}
