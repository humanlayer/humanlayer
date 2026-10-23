import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useAuth } from '@workos-inc/authkit-react'

import { useSync } from '@/components/providers/SyncProvider'
import { isAttachedSessionsOnly } from '@/lib/daemon-version'

/** First online host id (alphabetical) that can start work — used for directory autocomplete. */
export function useFirstOnlineHostId(): string | null {
	const { onlineHostsCollection } = useSync()
	const { user } = useAuth()

	const { data } = useLiveQuery(
		(q) => {
			if (!user?.id) return undefined
			return q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.user_id, user.id), eq(hosts.status, 'online')))
				.orderBy(({ hosts }) => hosts.host_id, 'asc')
		},
		[onlineHostsCollection, user?.id],
	)

	return data?.find((host) => !isAttachedSessionsOnly(host))?.host_id ?? null
}
