import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

interface HostRegistrationIdentity {
	hostId: string
	organizationId: string
	userId: string
}

export function useIsHostOnline(identity: HostRegistrationIdentity | undefined | null) {
	const { onlineHostsCollection } = useSync()
	const hostId = identity?.hostId
	const organizationId = identity?.organizationId
	const userId = identity?.userId

	const result = useLiveQuery(
		(q) => {
			if (!hostId || !organizationId || !userId) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.select(({ hosts }) => ({
					status: hosts.status,
				}))
				.where(({ hosts }) =>
					and(
						eq(hosts.host_id, hostId),
						eq(hosts.organization_id, organizationId),
						eq(hosts.user_id, userId),
					),
				)
		},
		[onlineHostsCollection, hostId, organizationId, userId],
	)

	if (!hostId || !organizationId || !userId) {
		return { isOnline: true, isLoading: false }
	}

	const isLoading = !result.isReady
	const isOnline = result.data?.[0]?.status === 'online'

	return { isOnline, isLoading }
}
