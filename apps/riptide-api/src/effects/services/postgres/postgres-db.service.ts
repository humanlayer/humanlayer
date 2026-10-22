import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { type Cause, Context, Data, Effect, Exit, Layer } from 'effect'

import { type PostgresDbErrorKind, PostgresDbQueryError, PostgresDbTransactionError } from './postgres-db.errors'

export type PostgresDbClient = PgDatabase<PostgresJsQueryResultHKT>
export type PostgresDbTransactionClient = PgDatabase<PostgresJsQueryResultHKT>

type QueryLike<A> = PromiseLike<A> | { execute: () => Promise<A> }
type QueryKind = 'select' | 'insert' | 'update' | 'delete' | 'raw' | 'unknown'

interface DrizzleQueryMetadata {
	readonly sql?: string
	readonly queryKind: QueryKind
}

export interface EffectPostgresDbService {
	readonly client: PostgresDbClient
	readonly query: <A>(query: QueryLike<A>) => Effect.Effect<A, PostgresDbQueryError>
	readonly run: <A>(fn: () => Promise<A>) => Effect.Effect<A, PostgresDbQueryError>
	readonly transaction: <A, E, R>(
		fn: (tx: PostgresTransaction) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | PostgresDbTransactionError, R>
}

export interface PostgresTransaction {
	readonly client: PostgresDbTransactionClient
	readonly query: <A>(query: QueryLike<A>) => Effect.Effect<A, PostgresDbQueryError>
	readonly run: <A>(fn: () => Promise<A>) => Effect.Effect<A, PostgresDbQueryError>
}

export class PostgresDb extends Context.Service<PostgresDb, EffectPostgresDbService>()('PostgresDb') {}

class TransactionProgramExit extends Data.TaggedError('TransactionProgramExit')<{}> {}

export function makeEffectPostgresDbService(client: PostgresDbClient): EffectPostgresDbService {
	return {
		client,
		query: makeQuery,
		run: makeRun,
		transaction: makeTransaction(client),
	}
}

export const PostgresDbLive = (client: PostgresDbClient) =>
	Layer.succeed(PostgresDb, makeEffectPostgresDbService(client))

function makePostgresTransaction(client: PostgresDbTransactionClient): PostgresTransaction {
	return {
		client,
		query: makeQuery,
		run: makeRun,
	}
}

function makeQuery<A>(query: QueryLike<A>): Effect.Effect<A, PostgresDbQueryError> {
	const metadata = extractDrizzleQueryMetadata(query)
	const attributes = metadataToAnnotations(metadata)

	return Effect.tryPromise({
		try: () => ('execute' in query ? query.execute() : Promise.resolve(query)),
		catch: (cause) => PostgresDbQueryError.fromCause(cause),
	}).pipe(
		Effect.tap(() => Effect.logDebug('Postgres query completed').pipe(Effect.annotateLogs(attributes))),
		Effect.tapError((error) =>
			Effect.logError('Postgres query failed').pipe(
				Effect.annotateLogs({
					...attributes,
					...postgresDbErrorLogAnnotations(error),
				}),
			),
		),
		Effect.withSpan('postgres.query', { attributes }),
	)
}

function makeRun<A>(fn: () => Promise<A>): Effect.Effect<A, PostgresDbQueryError> {
	const metadata: DrizzleQueryMetadata = { queryKind: 'unknown' }
	const attributes = metadataToAnnotations(metadata)

	return Effect.tryPromise({
		try: fn,
		catch: (cause) => PostgresDbQueryError.fromCause(cause),
	}).pipe(
		Effect.tap(() => Effect.logDebug('Postgres query completed').pipe(Effect.annotateLogs(attributes))),
		Effect.tapError((error) =>
			Effect.logError('Postgres query failed').pipe(
				Effect.annotateLogs({
					...attributes,
					...postgresDbErrorLogAnnotations(error),
				}),
			),
		),
		Effect.withSpan('postgres.query', { attributes }),
	)
}

function makeTransaction(client: PostgresDbClient): EffectPostgresDbService['transaction'] {
	return <A, E, R>(fn: (tx: PostgresTransaction) => Effect.Effect<A, E, R>) => {
		const attributes = { 'db.system': 'postgresql' }
		let programFailure: Cause.Cause<E> | undefined

		return Effect.gen(function* () {
			const context = yield* Effect.context<R>()

			const result = yield* Effect.tryPromise({
				try: () =>
					client.transaction(async (rawTx) => {
						const tx = makePostgresTransaction(rawTx)
						const exit = await Effect.runPromiseExit(fn(tx).pipe(Effect.provide(context)))

						if (Exit.isSuccess(exit)) return exit.value

						programFailure = exit.cause
						throw new TransactionProgramExit()
					}),
				catch: (cause) => {
					if (cause instanceof TransactionProgramExit) return cause
					return PostgresDbTransactionError.fromCause(cause)
				},
			}).pipe(
				Effect.tap(() =>
					Effect.logDebug('Postgres transaction completed').pipe(Effect.annotateLogs(attributes)),
				),
				Effect.tapError((error) => {
					if (error instanceof TransactionProgramExit) return Effect.void

					return Effect.logError('Postgres transaction failed').pipe(
						Effect.annotateLogs({
							...attributes,
							...postgresDbErrorLogAnnotations(error),
						}),
					)
				}),
				Effect.catchTag('TransactionProgramExit', () =>
					programFailure === undefined
						? Effect.die(new Error('Transaction program exited without preserving its failure cause'))
						: Effect.failCause(programFailure),
				),
			)

			return result
		}).pipe(Effect.withSpan('postgres.transaction', { attributes }))
	}
}

function extractDrizzleQueryMetadata(query: unknown): DrizzleQueryMetadata {
	if (typeof query !== 'object' || query === null) return { queryKind: 'unknown' }

	if ('getQuery' in query && typeof query.getQuery === 'function') {
		return queryToMetadata(() => (query as { getQuery: () => unknown }).getQuery())
	}

	if ('toSQL' in query && typeof query.toSQL === 'function') {
		return queryToMetadata(() => (query as { toSQL: () => unknown }).toSQL())
	}

	return { queryKind: 'unknown' }
}

function queryToMetadata(getQuery: () => unknown): DrizzleQueryMetadata {
	try {
		const result = getQuery() as { sql?: unknown }
		const sql = typeof result.sql === 'string' ? result.sql : undefined
		return { sql, queryKind: inferQueryKindFromSql(sql) }
	} catch {
		return { queryKind: 'unknown' }
	}
}

function inferQueryKindFromSql(sql: unknown): QueryKind {
	if (typeof sql !== 'string') return 'unknown'
	const firstWord = sql.trimStart().split(/\s+/, 1)[0]?.toLowerCase()
	switch (firstWord) {
		case 'select':
			return 'select'
		case 'insert':
			return 'insert'
		case 'update':
			return 'update'
		case 'delete':
			return 'delete'
		default:
			return 'raw'
	}
}

function metadataToAnnotations(metadata: DrizzleQueryMetadata): Record<string, string> {
	return removeUndefinedValues({
		'db.system': 'postgresql',
		'db.query.kind': metadata.queryKind,
		'db.query.text': metadata.sql,
	})
}

function removeUndefinedValues(input: Record<string, string | undefined>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
	)
}

export function postgresDbErrorLogAnnotations(error: {
	readonly kind: PostgresDbErrorKind
	readonly code?: string
	readonly retryable: boolean
}): {
	'db.error.kind': PostgresDbErrorKind
	'db.error.retryable': boolean
	'db.error.code'?: string
} {
	const annotations: {
		'db.error.kind': PostgresDbErrorKind
		'db.error.retryable': boolean
		'db.error.code'?: string
	} = {
		'db.error.kind': error.kind,
		'db.error.retryable': error.retryable,
	}
	if (error.code) annotations['db.error.code'] = error.code
	return annotations
}
