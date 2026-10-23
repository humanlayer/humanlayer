import { BasicIndex, type IndexConstructor } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection } from '@tanstack/react-db'
import z from 'zod/v4'

import { defaultCollectionKey } from './collection-key.ts'
import type { CollectionHealthTracker } from './health-tracker.ts'
import { createQuerySyncErrorHandler, type SyncErrorReporter } from './sync-error-handler.ts'
import { coerceBigIntFields, createSyncQueryFn, type SyncQueryPagination } from './sync-query-helpers.ts'

export type QueryCollectionIndexDefinition<T> = {
	readonly field: (row: T) => unknown
	readonly name: string
	readonly indexType: IndexConstructor
}

export type QueryCollectionOptions<TSchema extends z.ZodType<Record<string, unknown>>> = {
	readonly id: string
	readonly queryKey: readonly unknown[]
	readonly procedure: (input: Record<string, unknown>) => Promise<{ rows: unknown[] }>
	readonly rowSchema: TSchema
	readonly input?: Record<string, unknown>
	readonly tracker: CollectionHealthTracker
	readonly collectionName: string
	readonly queryClient: QueryClient
	readonly captureException?: SyncErrorReporter
	readonly bigIntFields?: readonly (keyof z.output<TSchema>)[]
	readonly indexes?: readonly QueryCollectionIndexDefinition<z.output<TSchema>>[]
	readonly getKey?: (item: z.output<TSchema>) => string
	readonly refetchInterval?: number | false
	readonly pagination?: SyncQueryPagination
}

/** Builds a TanStack query-backed sync collection for browser and daemon fallback modes. */
const QueryResultRowsSchema = z.array(z.record(z.string(), z.unknown()))

export function createQueryCollection<TSchema extends z.ZodType<Record<string, unknown>>>(
	options: QueryCollectionOptions<TSchema>,
) {
	type Row = z.output<TSchema>
	const getKey = options.getKey ?? defaultCollectionKey
	const onError = createQuerySyncErrorHandler({
		collectionName: options.collectionName,
		syncMode: 'query',
		captureException: options.captureException,
	})
	const collection = createCollection(
		queryCollectionOptions({
			id: options.id,
			queryKey: options.queryKey,
			queryFn: createSyncQueryFn(
				options.procedure,
				options.input,
				options.tracker,
				options.collectionName,
				onError,
				options.pagination,
			),
			select: (data): Row[] => {
				const rows = QueryResultRowsSchema.parse(data.rows)
				const coercedRows = options.bigIntFields?.length
					? coerceBigIntFields(rows, options.bigIntFields.map(String))
					: rows
				return options.rowSchema.array().parse(coercedRows)
			},
			queryClient: options.queryClient,
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey,
			syncMode: 'on-demand',
			refetchInterval: options.refetchInterval,
			retry: false,
		}),
	)

	for (const index of options.indexes ?? []) {
		collection.createIndex(index.field as never, { name: index.name, indexType: index.indexType })
	}

	return collection
}
