import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'
import { daemonSupports } from '@/lib/daemon-version'

export interface SessionHostRepositoryReporting {
	/** `unknown` while the session or its host row has not synced: never a reason to explain anything. */
	readonly state: 'unknown' | 'reports' | 'cannot_report'
	readonly hostName: string | null
}

const UNKNOWN: SessionHostRepositoryReporting = { state: 'unknown', hostName: null }

/**
 * Whether the daemon running a session can report the repositories it works in. A daemon built
 * before the repository observer reads as `cannot_report`, so the pull request panel can say why it
 * has nothing rather than showing an empty branch list. A daemon whose support is unknown gets the
 * benefit of the doubt.
 */
export function useSessionHostRepositoryReporting(sessionId: string | null): SessionHostRepositoryReporting {
	const { sessionsCollection, onlineHostsCollection } = useSync()
	const { data: sessions } = useLiveQuery(
		(q) =>
			sessionId
				? q.from({ sessions: sessionsCollection }).where(({ sessions }) => eq(sessions.id, sessionId))
				: undefined,
		[sessionsCollection, sessionId],
	)
	const hostId = sessions?.[0]?.host_id ?? null
	const { data: hosts } = useLiveQuery(
		(q) =>
			hostId
				? q
						.from({ hosts: onlineHostsCollection })
						.where(({ hosts }) => eq(hosts.host_id, hostId))
						.select(({ hosts }) => ({
							host_name: hosts.host_name,
							daemon_version: hosts.daemon_version,
							distribution: hosts.distribution,
							capabilities: hosts.capabilities,
						}))
				: undefined,
		[onlineHostsCollection, hostId],
	)

	const host = hosts?.[0]
	if (!host) return UNKNOWN
	return {
		state: daemonSupports(host, 'reportsRepositories') === 'unsupported' ? 'cannot_report' : 'reports',
		hostName: host.host_name ?? null,
	}
}
