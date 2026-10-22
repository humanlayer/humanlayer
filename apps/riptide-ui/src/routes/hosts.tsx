import { useLiveQuery } from '@tanstack/react-db'
import { createFileRoute } from '@tanstack/react-router'

import { useSync } from '@/components/providers/SyncProvider'

export const Route = createFileRoute('/hosts')({
	component: RouteComponent,
})

function RouteComponent() {
	const { onlineHostsCollection } = useSync()

	const hosts = useLiveQuery(
		(q) => q.from({ hosts: onlineHostsCollection }).orderBy(({ hosts }) => hosts.host_id, 'asc'),
		[onlineHostsCollection],
	)

	return <div>{JSON.stringify(hosts.data)}</div>
}
