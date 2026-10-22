import { type StandardSchema } from '@tanstack/db'

import type { BrowserCollectionConfig, BrowserCollectionDeps } from './collection-builder-types.ts'
import { type CacheableCollection, createCollectionCache } from './collection-cache.ts'
import { createElectricCollection } from './electric-collection.ts'
import { attachElectricKeepAlive } from './electric-keep-alive.ts'
import { AccessTokenUnavailableError } from './sync-config.ts'

export function createBrowserElectricCollection<TSchema extends StandardSchema<object>>(
	config: BrowserCollectionConfig<TSchema>,
) {
	const create = (deps: BrowserCollectionDeps) => {
		const collection = createElectricCollection({
			schema: config.schema,
			collectionName: config.collectionName,
			syncOrigin: deps.syncOrigin,
			syncVersion: config.routeVersion ?? deps.syncVersion,
			routePath: config.routePath,
			tracker: deps.tracker,
			headers: {
				Authorization: async () => {
					try {
						return `Bearer ${await deps.tokenFetcher()}`
					} catch (e) {
						throw new AccessTokenUnavailableError('Failed to fetch access token', { cause: e })
					}
				},
			},
			shouldRetryOnFailure: deps.shouldRetryOnFailure,
			logger: deps.logger,
			captureException: deps.captureException,
			isAuthUnavailableError: (e) => e instanceof AccessTokenUnavailableError,
			getKey: config.getKey,
		})

		for (const index of config.indexes ?? []) {
			collection.createIndex(index.field as never, { name: index.name, indexType: index.indexType })
		}

		// Keep this collection's ShapeStream long-polling while it is degraded to query mode, so
		// the health tracker observes Electric successes and recovers it without a reload (CORE-1326).
		// Self-tears-down on the collection's `cleaned-up` status, so it never outlives the collection.
		attachElectricKeepAlive(collection, deps.tracker, config.collectionName, {
			logger: deps.logger,
			captureException: deps.captureException,
		})

		return collection
	}

	const cache = createCollectionCache(create)

	// Track all collections created by this builder to cleanup when replaced
	const activeCollections = new Set<CacheableCollection>()

	return {
		create,
		get: (
			userId: string | null,
			organizationId: string | null,
			deps: BrowserCollectionDeps,
			isLoading: boolean,
		) => {
			const collection = cache.get(`${userId}:${organizationId}:v${deps.syncVersion}`, deps, {
				skipCache: isLoading,
			})

			// Cleanup all previous collections that aren't the one we're returning
			for (const prev of activeCollections) {
				if (prev !== collection) {
					deps.logger.info(`Cleaning up previous ${config.collectionName} collection`)
					prev.cleanup()
					activeCollections.delete(prev)
				}
			}

			// Track and log if this is a new collection
			if (!activeCollections.has(collection)) {
				deps.logger.info(`Collection ${config.collectionName} started syncing`, {
					userId,
					organizationId,
					isLoading,
					shouldRetryOnFailure: deps.shouldRetryOnFailure,
				})
				activeCollections.add(collection)
			}

			return collection
		},
	}
}
