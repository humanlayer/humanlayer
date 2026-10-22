import { type IR, parseOrderByExpression, parseWhereExpression } from '@tanstack/db'

/**
 * Wire format for a where expression sent to oRPC sync routes.
 * Mirrors the WhereExpression type from @humanlayer/riptide-api-contract.
 *
 * Defined locally to keep this package free of API contract dependencies.
 * The actual oRPC routes accept this shape via their Zod schemas.
 */
export type SyncWhereExpression =
	| {
			type: 'comparison'
			field: string[]
			operator: string
			value?: unknown
	  }
	| {
			type: 'and'
			conditions: SyncWhereExpression[]
	  }
	| {
			type: 'or'
			conditions: SyncWhereExpression[]
	  }
	| {
			type: 'not'
			condition: SyncWhereExpression
	  }

/**
 * Convert a TanStack DB IR where expression tree into a WhereExpression
 * wire format for the oRPC sync routes.
 *
 * Uses parseWhereExpression with handlers that produce WhereExpression nodes.
 * Unknown operators are silently dropped (onUnknownOperator returns null).
 */
export function intermediateRepresentationToWhereExpression(
	where: IR.BasicExpression<boolean> | undefined | null,
): SyncWhereExpression | undefined {
	if (!where) return undefined

	const result = parseWhereExpression<SyncWhereExpression | null>(where, {
		handlers: {
			eq: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'eq',
				value,
			}),
			gt: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'gt',
				value,
			}),
			gte: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'gte',
				value,
			}),
			lt: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'lt',
				value,
			}),
			lte: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'lte',
				value,
			}),
			in: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'in',
				value,
			}),
			like: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'like',
				value,
			}),
			ilike: (field: string[], value: unknown) => ({
				type: 'comparison' as const,
				field,
				operator: 'ilike',
				value,
			}),
			isNull: (field: string[]) => ({
				type: 'comparison' as const,
				field,
				operator: 'isNull',
			}),
			isUndefined: (field: string[]) => ({
				type: 'comparison' as const,
				field,
				operator: 'isUndefined',
			}),
			and: (...children: Array<SyncWhereExpression | null>) => {
				const conditions = children.filter((c): c is SyncWhereExpression => c !== null)
				if (conditions.length === 0) return null
				if (conditions.length === 1) return conditions[0] ?? null
				return { type: 'and' as const, conditions }
			},
			or: (...children: Array<SyncWhereExpression | null>) => {
				const conditions = children.filter((c): c is SyncWhereExpression => c !== null)
				if (conditions.length === 0) return null
				if (conditions.length === 1) return conditions[0] ?? null
				return { type: 'or' as const, conditions }
			},
			not: (child: SyncWhereExpression | null) => {
				if (!child) return null
				// Optimize not(comparison) into not_* operator
				if (child.type === 'comparison') {
					return {
						type: 'comparison' as const,
						field: child.field,
						operator: `not_${child.operator}`,
						value: child.value,
					}
				}
				return { type: 'not' as const, condition: child }
			},
		},
		onUnknownOperator: (_op: string, _args: unknown[]) => null,
	})

	return result ?? undefined
}

/**
 * Convert TanStack DB IR orderBy into the SyncSort wire format.
 */
export function irToSorts(
	orderBy: IR.OrderBy | undefined | null,
): Array<{ field: string[]; direction: 'asc' | 'desc'; nulls: 'first' | 'last' }> {
	if (!orderBy) return []
	const parsed = parseOrderByExpression(orderBy)
	return parsed.map((s) => ({
		field: s.field as string[],
		direction: s.direction,
		nulls: s.nulls,
	}))
}

export interface SyncQueryPagination {
	readonly pageSize: number
	/** Appended when absent so offset pagination has a deterministic order. */
	readonly stableSorts: ReadonlyArray<{
		readonly field: ReadonlyArray<string>
		readonly direction: 'asc' | 'desc'
		readonly nulls: 'first' | 'last'
	}>
}

/**
 * The subset of loadSubsetOptions from TanStack DB's query context.
 */
interface LoadSubsetOptions {
	where?: IR.BasicExpression<boolean>
	orderBy?: IR.OrderBy
	limit?: number
}

/**
 * Factory that creates a ctx-aware queryFn for query-driven collections.
 *
 * Reads ctx.meta.loadSubsetOptions, serializes where/orderBy/limit to the
 * WhereExpression wire format, and calls the API method.
 *
 * @param apiFn - The oRPC sync method to call (e.g. apiClient.sync.sessions)
 * @param extraInput - Additional input fields (e.g. { hostId } for daemon sessions)
 */
/**
 * Coerce string-encoded bigint fields back to BigInt values.
 *
 * The API serializes BigInt via `BigInt.prototype.toJSON = () => this.toString()`,
 * so bigint columns arrive as strings like `"1771621345994"`. Electric SQL handles
 * this internally, but query-based collections receive raw JSON and need explicit
 * coercion to match the drizzle schema (`mode: 'bigint'`).
 *
 * @param rows - Array of row objects from the API response
 * @param fields - Array of field names that should be coerced to BigInt
 */
export function coerceBigIntFields<T extends Record<string, unknown>>(rows: T[], fields: (keyof T)[]): T[] {
	return rows.map((row) => {
		const coerced = { ...row }
		for (const field of fields) {
			const val = coerced[field]
			if (typeof val === 'string' && val !== '') {
				;(coerced as Record<string, unknown>)[field as string] = BigInt(val)
			}
		}
		return coerced
	})
}

/** Minimal tracker interface so this module stays free of health-tracker imports. */
interface QueryHealthTracker {
	recordQueryError(name: string): void
	recordQuerySuccess(name: string): void
}

function addStableSorts(
	sorts: ReadonlyArray<{ field: string[]; direction: 'asc' | 'desc'; nulls: 'first' | 'last' }>,
	pagination: SyncQueryPagination | undefined,
) {
	if (!pagination) return sorts
	return [
		...sorts,
		...pagination.stableSorts.filter(
			(stableSort) => !sorts.some((sort) => sort.field.join('.') === stableSort.field.join('.')),
		),
	]
}

async function fetchAllPages<T extends { rows: unknown[] }>(
	apiFn: (input: Record<string, unknown>) => Promise<T>,
	input: Record<string, unknown>,
	pagination: SyncQueryPagination,
): Promise<T> {
	if (!Number.isSafeInteger(pagination.pageSize) || pagination.pageSize <= 0) {
		throw new Error('Sync query pagination pageSize must be a positive safe integer')
	}

	const rows: unknown[] = []
	for (let offset = 0; ; ) {
		const page = await apiFn({ ...input, limit: pagination.pageSize, offset })
		rows.push(...page.rows)
		if (page.rows.length < pagination.pageSize) return { ...page, rows }
		offset += page.rows.length
	}
}

export function createSyncQueryFn<T extends { rows: unknown[] }>(
	apiFn: (input: Record<string, unknown>) => Promise<T>,
	extraInput: Record<string, unknown> | undefined,
	tracker: QueryHealthTracker,
	collectionName: string,
	onError: (error: unknown) => void,
	pagination?: SyncQueryPagination,
): (ctx: { meta?: { loadSubsetOptions?: LoadSubsetOptions } }) => Promise<T> {
	return async (ctx) => {
		const loadSubsetOptions = ctx.meta?.loadSubsetOptions
		const where = intermediateRepresentationToWhereExpression(loadSubsetOptions?.where)
		const sorts = addStableSorts(irToSorts(loadSubsetOptions?.orderBy), pagination)
		const limit = loadSubsetOptions?.limit

		const input: Record<string, unknown> = {
			where,
			sorts,
			...extraInput,
		}
		if (limit !== undefined) input.limit = limit

		try {
			const result =
				pagination && limit === undefined ? await fetchAllPages(apiFn, input, pagination) : await apiFn(input)
			tracker.recordQuerySuccess(collectionName)
			return result
		} catch (err) {
			tracker.recordQueryError(collectionName)
			onError(err)
			throw err
		}
	}
}
