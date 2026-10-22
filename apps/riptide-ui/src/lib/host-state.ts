import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'

import { isLocalDaemonStarting, type LocalDaemonLaunchPhase } from '@/hooks/stores/localDaemonLaunchStore'
import { getHostStatus } from '@/lib/host-status'
import { isUpdateStalled } from '@/lib/host-update'

export type HostState = 'online' | 'starting' | 'updating' | 'offline' | 'removed'

type WaitableHostState = Exclude<HostState, 'online' | 'removed'>

export type HostStateRow = Pick<OnlineHost, 'status' | 'last_seen' | 'update_state'>

export interface HostStateInput {
	host: HostStateRow | null
	isLocal: boolean
	localPhase: LocalDaemonLaunchPhase
	nowMs: number
}

export function deriveHostState({ host, isLocal, localPhase, nowMs }: HostStateInput): HostState {
	if (!host && !isLocal) return 'removed'
	if (host?.update_state === 'installing' && !isUpdateStalled(host, nowMs)) return 'updating'
	if (host && getHostStatus(host, nowMs) === 'online') return 'online'
	if (isLocal && isLocalDaemonStarting(localPhase)) return 'starting'
	return 'offline'
}

const STATE_SORT_RANK: Record<HostState, number> = { online: 0, starting: 1, updating: 1, offline: 2, removed: 3 }

export function sortHostsByState<T extends { state?: HostState; label: string }>(hosts: readonly T[]): T[] {
	return [...hosts].sort(
		(a, b) =>
			STATE_SORT_RANK[a.state ?? 'online'] - STATE_SORT_RANK[b.state ?? 'online'] ||
			a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
	)
}

export type UnavailableHostLaunchPolicy = 'queue' | 'block'

export const UNAVAILABLE_HOST_LAUNCH_POLICY: UnavailableHostLaunchPolicy = 'queue'

export interface HostLaunchTarget {
	state: HostState
	registered: boolean
	hostLabel: string
	isLocal: boolean
}

export function hostAcceptsLaunch(
	{ state, registered }: Pick<HostLaunchTarget, 'state' | 'registered'>,
	policy: UnavailableHostLaunchPolicy = UNAVAILABLE_HOST_LAUNCH_POLICY,
): boolean {
	if (!registered) return false
	return state === 'online' || policy === 'queue'
}

export function describeHostLaunchBlocker(
	target: HostLaunchTarget,
	policy: UnavailableHostLaunchPolicy = UNAVAILABLE_HOST_LAUNCH_POLICY,
): string | null {
	if (hostAcceptsLaunch(target, policy)) return null
	if (target.state === 'removed') return 'Choose another host'
	return `Wait for ${target.isLocal ? 'this device' : target.hostLabel} to come online`
}

export interface HostStateCopyInput {
	state: HostState
	hostLabel: string
	isLocal: boolean
	acceptsLaunch: boolean
}

export interface HostStateCopy {
	badge: string | null
	notice: string | null
}

const BADGES: Record<HostState, string | null> = {
	online: null,
	starting: 'Starting…',
	updating: 'Updating…',
	offline: 'Offline',
	removed: null,
}

const STATE_PHRASES: Record<WaitableHostState, string> = {
	starting: 'is starting',
	updating: 'is updating',
	offline: 'is offline',
}

const REMOVED_HOST_NOTICE = 'This host is no longer connected. Choose another host.'

const QUEUED_OUTCOME: Record<WaitableHostState, string> = {
	starting: "Your task runs when it's online.",
	updating: "Your task runs when it's back.",
	offline: 'Your task runs when it reconnects.',
}

const BLOCKED_OUTCOME: Record<WaitableHostState, string> = {
	starting: "You can launch when it's online.",
	updating: "You can launch when it's back.",
	offline: 'Choose another host, or launch when it reconnects.',
}

export function describeHostState({ state, hostLabel, isLocal, acceptsLaunch }: HostStateCopyInput): HostStateCopy {
	if (state === 'online') return { badge: null, notice: null }
	if (state === 'removed') return { badge: BADGES.removed, notice: REMOVED_HOST_NOTICE }
	const subject = isLocal ? 'This device' : hostLabel
	const outcome = acceptsLaunch ? QUEUED_OUTCOME[state] : BLOCKED_OUTCOME[state]
	return { badge: BADGES[state], notice: `${subject} ${STATE_PHRASES[state]}. ${outcome}` }
}
