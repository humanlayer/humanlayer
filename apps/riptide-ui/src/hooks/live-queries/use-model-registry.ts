import type { HostModelCatalog } from '@humanlayer/schemas/zod/model-catalog'
import { and, eq, isNull, not, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { createModelRegistry, type ModelRegistry } from '@/lib/model-registry'

function useHostModelCatalog(hostId: string | null | undefined): HostModelCatalog | null {
	const { onlineHostsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) =>
			hostId
				? q
						.from({ hosts: onlineHostsCollection })
						.where(({ hosts }) => eq(hosts.host_id, hostId))
						.select(({ hosts }) => ({ supported_models: hosts.supported_models }))
				: undefined,
		[onlineHostsCollection, hostId],
	)
	return data?.find((row) => row.supported_models != null)?.supported_models ?? null
}

/**
 * The models the daemon on `hostId` can run. Answers from the bundled tables until the host row
 * syncs, for a daemon that predates the probe, and for a host whose first probe has not finished.
 */
export function useHostModelRegistry(hostId: string | null | undefined): ModelRegistry {
	const catalog = useHostModelCatalog(hostId)
	return useMemo(() => createModelRegistry(catalog), [catalog])
}

/** The registry of the session's host, looked up through the session row. */
export function useSessionModelRegistry(sessionId: string | null | undefined): ModelRegistry {
	const { sessionsCollection } = useSync()
	const { data: sessions } = useLiveQuery(
		(q) =>
			sessionId
				? q
						.from({ sessions: sessionsCollection })
						.where(({ sessions }) => eq(sessions.id, sessionId))
						.select(({ sessions }) => ({ host_id: sessions.host_id }))
				: undefined,
		[sessionsCollection, sessionId],
	)
	return useHostModelRegistry(sessions?.[0]?.host_id ?? null)
}

/**
 * A registry for surfaces with no host in scope, such as the settings page: the most recently
 * seen online host that has reported a catalog.
 */
export function useAnyHostModelRegistry(): ModelRegistry {
	const { onlineHostsCollection } = useSync()
	const { data } = useLiveQuery(
		(q) =>
			q
				.from({ hosts: onlineHostsCollection })
				.where(({ hosts }) => and(eq(hosts.status, 'online'), not(isNull(hosts.supported_models))))
				.orderBy(({ hosts }) => hosts.last_seen, 'desc')
				.limit(1)
				.select(({ hosts }) => ({ supported_models: hosts.supported_models })),
		[onlineHostsCollection],
	)
	const catalog = data?.[0]?.supported_models ?? null
	return useMemo(() => createModelRegistry(catalog), [catalog])
}
