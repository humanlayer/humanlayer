import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useAuth } from '@workos-inc/authkit-react'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { isLocalDaemonStarting, useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useNewTaskFormStore } from '@/hooks/stores/newTaskFormStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useLocalHostIdState } from '@/hooks/use-colocated'
import { isAttachedSessionsOnly } from '@/lib/daemon-version'
import { useHostStatsClock } from '@/lib/host-stats'
import { getHostStatus } from '@/lib/host-status'

export interface EffectiveHost {
	host_id: string
	organization_id: string
	user_id: string
	host_name: string | null
}

export interface UseEffectiveHostResult {
	/** True once the current user's host query has resolved and, on desktop, this device's host id is known. */
	isReady: boolean
	/** Online hosts for the current user, ordered alphabetically by name. */
	availableHosts: EffectiveHost[]
	/** True when at least one host is online. */
	hasHosts: boolean
	/**
	 * The host the form should act against: the user's explicit selection if it is
	 * online, otherwise the last-used host if online, otherwise the most recent host.
	 * Empty string when no hosts are available.
	 */
	hostId: string
	preferredHostId: string
	/** True when the effective host is the same machine running the Tauri app. */
	isColocated: boolean
	/** The local Tauri host id, or null in the browser / before resolution. */
	localHostId: string | null
	/** True when a host is selected and it is not the local machine. */
	isRemoteHost: boolean
}

export interface PreferredHostInput {
	hosts: ReadonlyArray<
		Pick<OnlineHost, 'host_id' | 'status' | 'last_seen'> & Partial<Pick<OnlineHost, 'capabilities'>>
	>
	userSelectedHostId: string | null
	lastUsedHostId: string | null
	localHostId: string | null
	localDaemonStarting: boolean
	/** The saved local daemon setting; defaults to on. */
	localDaemonEnabled?: boolean
	nowMs: number
}

export function pickPreferredHostId({
	hosts,
	userSelectedHostId,
	lastUsedHostId,
	localHostId,
	localDaemonStarting,
	localDaemonEnabled = true,
	nowMs,
}: PreferredHostInput): string {
	const launchableHosts = hosts.filter((host) => !isAttachedSessionsOnly({ capabilities: host.capabilities ?? null }))
	const onlineHosts = launchableHosts.filter((host) => getHostStatus(host, nowMs) === 'online')
	const isKnown = (hostId: string | null): hostId is string =>
		hostId !== null && launchableHosts.some((host) => host.host_id === hostId)
	// With the local daemon turned off, an offline local host is a poor default while another host is online.
	// An explicit selection still wins, so an open draft is never retargeted.
	const passOverLocalHost =
		!localDaemonEnabled &&
		localHostId !== null &&
		!onlineHosts.some((host) => host.host_id === localHostId) &&
		onlineHosts.length > 0
	if (isKnown(userSelectedHostId)) return userSelectedHostId
	if (isKnown(lastUsedHostId) && !(passOverLocalHost && lastUsedHostId === localHostId)) return lastUsedHostId
	const localHostHasNoRow = !hosts.some((host) => host.host_id === localHostId)
	if (localHostId && !passOverLocalHost && (isKnown(localHostId) || (localDaemonStarting && localHostHasNoRow))) {
		return localHostId
	}
	return onlineHosts[0]?.host_id ?? ''
}

function pickOnlineHostId(
	onlineHosts: readonly EffectiveHost[],
	userSelectedHostId: string | null,
	lastUsedHostId: string | null,
): string {
	const isOnline = (hostId: string | null): hostId is string =>
		hostId !== null && onlineHosts.some((host) => host.host_id === hostId)
	if (isOnline(userSelectedHostId)) return userSelectedHostId
	if (isOnline(lastUsedHostId)) return lastUsedHostId
	return onlineHosts[0]?.host_id ?? ''
}

export function useEffectiveHost(): UseEffectiveHostResult {
	const { user } = useAuth()
	const [lastUsedHostId] = useLocalStorage<string | null>('riptide:lastUsedHostId', null)
	const userSelectedHostId = useNewTaskFormStore((s) => s.userSelectedHostId)
	const localDaemonStarting = useLocalDaemonLaunchStore((state) => isLocalDaemonStarting(state.phase))
	const localDaemonEnabled = useSettingsStore((state) => state.localDaemonEnabled)
	const { localHostId, isResolved: localHostIdResolved } = useLocalHostIdState()
	const nowMs = useHostStatsClock()

	const { onlineHostsCollection } = useSync()
	const hostsQuery = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => eq(hosts.user_id, user.id))
				.select(({ hosts }) => ({
					host_id: hosts.host_id,
					organization_id: hosts.organization_id,
					user_id: hosts.user_id,
					host_name: hosts.host_name,
					capabilities: hosts.capabilities,
					status: hosts.status,
					last_seen: hosts.last_seen,
				}))
				.orderBy(({ hosts }) => hosts.host_name, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)

	const knownHosts = useMemo(() => hostsQuery.data?.filter((h) => h.host_id) ?? [], [hostsQuery.data])
	const availableHosts = useMemo<EffectiveHost[]>(
		() =>
			knownHosts.flatMap(({ host_id, organization_id, user_id, host_name, status, capabilities }) =>
				status === 'online' && !isAttachedSessionsOnly({ capabilities })
					? [{ host_id, organization_id, user_id, host_name }]
					: [],
			),
		[knownHosts],
	)
	const hasHosts = availableHosts.length > 0

	const hostId = pickOnlineHostId(availableHosts, userSelectedHostId, lastUsedHostId)
	const preferredHostId = pickPreferredHostId({
		hosts: knownHosts,
		userSelectedHostId,
		lastUsedHostId,
		localHostId,
		localDaemonStarting,
		localDaemonEnabled,
		nowMs,
	})

	const isColocated = Boolean(localHostId && hostId && localHostId === hostId)
	const isRemoteHost = hostId ? !isColocated : false

	return {
		isReady: hostsQuery.isReady && localHostIdResolved,
		availableHosts,
		hasHosts,
		hostId,
		preferredHostId,
		isColocated,
		localHostId,
		isRemoteHost,
	}
}
