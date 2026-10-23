import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import semver from 'semver'

import { type DaemonCapabilityFields, daemonSupports, parseCliDaemonVersion } from './daemon-version'

export type HostUpdateState = 'unknown' | 'current' | 'outdated' | 'requested' | 'installing' | 'failed'

export type HostUpdateFields = Pick<OnlineHost, 'daemon_version' | 'distribution' | 'can_self_update' | 'update_state'>

const UPDATE_STALLED_AFTER_MS = 5 * 60_000

export const STALLED_UPDATE_ERROR = 'Could not restart the daemon after the update. Start it on the host, or retry.'

export function isUpdateStalled(host: Pick<OnlineHost, 'update_state' | 'last_seen'>, nowMs: number): boolean {
	return host.update_state === 'installing' && BigInt(nowMs) - host.last_seen >= BigInt(UPDATE_STALLED_AFTER_MS)
}

export const OLD_UPDATER_STALLED_UPDATE_ERROR = 'The daemon stopped during the update. Start it on the host to finish.'

export function hasOldSelfUpdater(host: DaemonCapabilityFields & Pick<OnlineHost, 'can_self_update'>): boolean {
	return isHostUpdatable(host) && daemonSupports(host, 'restartsAfterSelfUpdate') === 'unsupported'
}

export function isHostUpdatable(host: Pick<HostUpdateFields, 'distribution' | 'can_self_update'>): boolean {
	return host.can_self_update === true && host.distribution === 'cli'
}

export function getHostUpdateState(host: HostUpdateFields, targetDaemonVersion: string | null): HostUpdateState {
	if (host.update_state) return host.update_state
	const daemonVersion = parseCliDaemonVersion(host)
	const targetVersion = semver.parse(targetDaemonVersion)
	if (daemonVersion === null || targetVersion === null) return 'unknown'
	return semver.lt(daemonVersion, targetVersion) ? 'outdated' : 'current'
}
