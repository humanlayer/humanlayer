/**
 * Minimal interface a collection must satisfy to be cache-managed.
 * Both Electric and Query collections from @tanstack/react-db satisfy this.
 */
export interface CacheableCollection {
	on(event: 'status:change', handler: (payload: { status: string }) => void): void
	cleanup(): void
}

/**
 * Creates a module-level cache for TanStack DB collections, handling:
 * - Deduplication by cache key (typically `${userId}:${organizationId}`)
 * - Auto-eviction when collection emits 'cleaned-up' status
 * - Explicit destroy with cleanup
 *
 * @param createFn - Factory function that creates a new collection instance
 */
export interface CollectionCache<TCollection extends CacheableCollection, TDeps> {
	get(cacheKey: string, deps: TDeps, opts?: { skipCache?: boolean }): TCollection
	destroy(cacheKey: string): void
}

export function createCollectionCache<TCollection extends CacheableCollection, TDeps>(
	createFn: (deps: TDeps) => TCollection,
): CollectionCache<TCollection, TDeps> {
	const cache = new Map<string, TCollection>()

	return {
		/**
		 * Get or create a cached collection instance.
		 * @param cacheKey - Cache key (e.g. `${userId}:${organizationId}`)
		 * @param deps - Dependencies passed to createFn when creating a new instance
		 * @param opts.skipCache - If true, creates but does not cache (used during auth loading for electric collections)
		 */
		get(cacheKey: string, deps: TDeps, opts?: { skipCache?: boolean }): TCollection {
			const existing = cache.get(cacheKey)
			if (existing) return existing

			const collection = createFn(deps)

			collection.on('status:change', ({ status }) => {
				if (status === 'cleaned-up') {
					cache.delete(cacheKey)
				}
			})

			if (!opts?.skipCache) {
				cache.set(cacheKey, collection)
			}

			return collection
		},

		/**
		 * Destroy a cached collection, calling cleanup() to stop sync.
		 * Cache eviction is handled by the 'status:change' listener registered in get().
		 * No-op if no collection exists for the given key.
		 */
		destroy(cacheKey: string): void {
			const collection = cache.get(cacheKey)
			if (collection) {
				collection.cleanup()
			}
		},
	}
}
