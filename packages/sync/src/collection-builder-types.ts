import type { Logger } from '@humanlayer/logger'
import type { IndexConstructor, InferSchemaOutput, StandardSchema } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'
import type z from 'zod/v4'

import type { CollectionKeyOption } from './collection-key.ts'
import type { CollectionHealthTracker } from './health-tracker.ts'
import type { SyncRouteVersion, SyncVersion } from './sync-config.ts'
import type { SyncErrorReporter } from './sync-error-handler.ts'
import type { SyncQueryPagination } from './sync-query-helpers.ts'

export type IndexDefinition<T> = {
	field: (row: T) => unknown
	name: string
	indexType: IndexConstructor
}

export type BrowserCollectionConfig<TSchema extends StandardSchema<object>> = {
	schema: TSchema
	routePath: string
	collectionName: string
	indexes?: IndexDefinition<InferSchemaOutput<TSchema>>[]
	/** Pin this collection to a specific proxy route version instead of the caller's org-wide syncVersion. */
	routeVersion?: SyncRouteVersion
} & CollectionKeyOption<InferSchemaOutput<TSchema>>

export type BrowserCollectionDeps = {
	syncOrigin: string
	tokenFetcher: () => Promise<string>
	shouldRetryOnFailure: boolean
	tracker: CollectionHealthTracker
	syncVersion: SyncVersion
	logger: Logger
	captureException?: SyncErrorReporter
}

export type BrowserQueryProcedure = (input: Record<string, unknown>) => Promise<{ rows: unknown[] }>

export type BrowserQueryCollectionConfig<TSchema extends z.ZodType<Record<string, unknown>>> = {
	collectionName: string
	procedure: (apiClient: unknown, syncVersion: SyncVersion) => BrowserQueryProcedure
	rowSchema: TSchema
	bigIntFields?: (keyof z.output<TSchema>)[]
	indexes?: IndexDefinition<z.output<TSchema>>[]
	refetchInterval?: number | false
	extraInput?: Record<string, unknown>
	pagination?: SyncQueryPagination
} & CollectionKeyOption<z.output<TSchema>>

export type BrowserQueryCollectionDeps = {
	apiClient: unknown
	tracker: CollectionHealthTracker
	queryClient: QueryClient
	syncVersion: SyncVersion
	id?: string
	captureException?: SyncErrorReporter
}
