import {
	BasicIndex,
	createCollection,
	type Collection,
	type InferSchemaOutput,
	type StandardSchema,
} from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

import { defaultCollectionKey } from './collection-key.ts'
import type { CollectionHealthTracker } from './health-tracker.ts'
import { buildElectricSyncUrl, DEFAULT_BACKOFF_OPTIONS, type SyncRouteVersion } from './sync-config.ts'
import { createElectricSyncErrorHandler, type SyncErrorReporter } from './sync-error-handler.ts'
import { createTrackedFetchClient } from './tracked-fetch.ts'

export type ElectricCollectionOptions<TSchema extends StandardSchema<object>> = {
	schema: TSchema
	collectionName: string
	syncOrigin: string
	syncVersion: SyncRouteVersion
	routePath: string
	tracker?: CollectionHealthTracker
	headers?: Record<string, string | (() => string) | (() => Promise<string>)>
	shouldRetryOnFailure: boolean
	logger: Parameters<typeof createElectricSyncErrorHandler>[0]['logger']
	captureException?: SyncErrorReporter
	isAuthUnavailableError?: (error: unknown) => boolean
	getKey?: (item: InferSchemaOutput<TSchema>) => string
}

export function createElectricCollection<TSchema extends StandardSchema<object>>(
	options: ElectricCollectionOptions<TSchema>,
): Collection<InferSchemaOutput<TSchema>, string | number> {
	const getKey = options.getKey ?? defaultCollectionKey
	const shapeOptions: {
		url: string
		subsetMethod: 'POST'
		headers: ElectricCollectionOptions<TSchema>['headers']
		onError: ReturnType<typeof createElectricSyncErrorHandler>
		backoffOptions: typeof DEFAULT_BACKOFF_OPTIONS
		fetchClient?: typeof fetch
	} = {
		url: buildElectricSyncUrl(options.syncOrigin, options.syncVersion, options.routePath),
		subsetMethod: 'POST',
		headers: options.headers,
		onError: createElectricSyncErrorHandler({
			collectionName: options.collectionName,
			shouldRetryOnFailure: options.shouldRetryOnFailure,
			logger: options.logger,
			captureException: options.captureException,
			isAuthUnavailableError: options.isAuthUnavailableError,
		}),
		backoffOptions: DEFAULT_BACKOFF_OPTIONS,
	}
	if (options.tracker !== undefined) {
		shapeOptions.fetchClient = createTrackedFetchClient(options.tracker, options.collectionName) as typeof fetch
	}

	// `electricCollectionOptions` loses a caller's Standard Schema type when it
	// flows through its invariant sync callback. Keep that escape hatch inside
	// this adapter so collection consumers retain their precise row type.
	return createCollection(
		electricCollectionOptions({
			schema: options.schema,
			shapeOptions,
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey,
			syncMode: 'on-demand',
		}) as never,
	) as never
}
