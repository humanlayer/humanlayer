import type z from 'zod/v4'

import type { BrowserQueryCollectionConfig, BrowserQueryCollectionDeps } from './collection-builder-types.ts'
import { createCollectionCache } from './collection-cache.ts'
import { type CollectionName, REFETCH_INTERVALS } from './constants.ts'
import { createQueryCollection } from './query-collection.ts'

export function createBrowserQueryCollection<TSchema extends z.ZodType<Record<string, unknown>>>(
	config: BrowserQueryCollectionConfig<TSchema>,
) {
	const create = (deps: BrowserQueryCollectionDeps) => {
		const collectionId = deps.id ?? `query-${config.collectionName}-${Date.now()}`
		const procedure = config.procedure(deps.apiClient, deps.syncVersion)
		return createQueryCollection({
			id: collectionId,
			queryKey: ['sync', config.collectionName, `v${deps.syncVersion}`, collectionId],
			procedure,
			rowSchema: config.rowSchema,
			input: config.extraInput,
			tracker: deps.tracker,
			collectionName: config.collectionName,
			queryClient: deps.queryClient,
			captureException: deps.captureException,
			bigIntFields: config.bigIntFields,
			indexes: config.indexes,
			// BrowserQueryCollectionConfig enforces either an id-bearing row or a
			// custom key; this wrapper keeps that conditional relation local.
			getKey: config.getKey,
			refetchInterval: config.refetchInterval ?? REFETCH_INTERVALS[config.collectionName as CollectionName],
			pagination: config.pagination,
		})
	}

	const cache = createCollectionCache(create)

	return {
		create,
		get: (userId: string | null, organizationId: string | null, deps: BrowserQueryCollectionDeps) =>
			cache.get(`${userId}:${organizationId}:v${deps.syncVersion}`, deps),
		destroy: (userId: string | null, organizationId: string | null, syncVersion = 2) =>
			cache.destroy(`${userId}:${organizationId}:v${syncVersion}`),
	}
}
