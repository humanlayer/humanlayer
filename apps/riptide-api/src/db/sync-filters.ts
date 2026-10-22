import type { SyncSort, WhereExpression } from '@humanlayer/riptide-api-contract/api/sync/shared-schemas'
import * as Sentry from '@sentry/node'
import type { Column, SQL } from 'drizzle-orm'
import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	not,
	notIlike,
	notInArray,
	notLike,
	or,
	sql,
} from 'drizzle-orm'
import { Data, Effect } from 'effect'

type TableColumns = Record<string, Column>

const MAX_EXPRESSION_DEPTH = 10

/**
 * Resolves a column name from the table columns map.
 * Throws SyncFilterError for empty field paths or unknown columns.
 */
function resolveColumn(tableColumns: TableColumns, field: string[], tableName: string): Column {
	const columnName = field[0]
	if (!columnName) {
		Sentry.captureException(new Error('Sync filter field path is empty'), {
			tags: { error_type: 'sync_filter_validation' },
			extra: { tableName, field },
		})
		throw new SyncFilterError('Filter field path must have at least one segment')
	}
	const column = tableColumns[columnName]
	if (!column) {
		Sentry.captureException(new Error(`Unknown sync filter column: ${columnName}`), {
			tags: { error_type: 'sync_filter_validation' },
			extra: { columnName, tableName },
		})
		throw new SyncFilterError(`Unknown column: ${columnName}`)
	}
	return column
}

/**
 * Maps a single comparison operator + value to a Drizzle SQL condition.
 */
function buildComparison(column: Column, operator: string, value: unknown, tableName: string): SQL {
	switch (operator) {
		case 'eq':
			return eq(column, value as never)
		case 'gt':
			return gt(column, value as never)
		case 'gte':
			return gte(column, value as never)
		case 'lt':
			return lt(column, value as never)
		case 'lte':
			return lte(column, value as never)
		case 'in':
			return inArray(column, value as never[])
		case 'isNull':
		case 'isUndefined':
			return isNull(column)
		case 'not_eq':
			return ne(column, value as never)
		case 'not_gt':
			return lte(column, value as never)
		case 'not_gte':
			return lt(column, value as never)
		case 'not_lt':
			return gte(column, value as never)
		case 'not_lte':
			return gt(column, value as never)
		case 'not_in':
			return notInArray(column, value as never[])
		case 'not_isNull':
		case 'not_isUndefined':
			return isNotNull(column)
		case 'like':
			return like(column, value as string)
		case 'ilike':
			return ilike(column, value as string)
		case 'not_like':
			return notLike(column, value as string)
		case 'not_ilike':
			return notIlike(column, value as string)
		default: {
			Sentry.captureException(new Error(`Unsupported sync filter operator: ${operator}`), {
				tags: { error_type: 'sync_filter_validation' },
				extra: { operator, tableName },
			})
			throw new SyncFilterError(`Unsupported operator: ${operator}`)
		}
	}
}

/**
 * Recursively walks a WhereExpression tree and produces Drizzle SQL.
 *
 * Supports nested and/or/not boolean logic plus all comparison operators.
 * Throws SyncFilterError at depth > MAX_EXPRESSION_DEPTH to prevent abuse.
 *
 * @param tableColumns - Column map from getTableColumns(table)
 * @param expression - Recursive WhereExpression tree from client
 * @param tableName - Table name for error context
 * @param depth - Current recursion depth (default 0)
 * @returns Drizzle SQL condition, or undefined if expression is undefined
 */
export function buildDrizzleWhereFromExpression(
	tableColumns: TableColumns,
	expression: WhereExpression | undefined,
	tableName = 'unknown',
	depth = 0,
): SQL | undefined {
	if (!expression) return undefined

	if (depth > MAX_EXPRESSION_DEPTH) {
		throw new SyncFilterError(`Filter expression exceeds maximum depth of ${MAX_EXPRESSION_DEPTH}`)
	}

	switch (expression.type) {
		case 'comparison': {
			const column = resolveColumn(tableColumns, expression.field, tableName)
			return buildComparison(column, expression.operator, expression.value, tableName)
		}
		case 'and': {
			const conditions = expression.conditions
				.map((c) => buildDrizzleWhereFromExpression(tableColumns, c, tableName, depth + 1))
				.filter((c): c is SQL => c !== undefined)
			if (conditions.length === 0) return undefined
			if (conditions.length === 1) return conditions[0]
			return and(...conditions) as SQL
		}
		case 'or': {
			const conditions = expression.conditions
				.map((c) => buildDrizzleWhereFromExpression(tableColumns, c, tableName, depth + 1))
				.filter((c): c is SQL => c !== undefined)
			if (conditions.length === 0) return undefined
			if (conditions.length === 1) return conditions[0]
			return or(...conditions) as SQL
		}
		case 'not': {
			const inner = buildDrizzleWhereFromExpression(tableColumns, expression.condition, tableName, depth + 1)
			if (!inner) return undefined
			return not(inner)
		}
		default: {
			const exhaustive: never = expression
			throw new SyncFilterError(`Unknown expression type: ${(exhaustive as { type: string }).type}`)
		}
	}
}

/**
 * Maps an array of client-supplied sort directives to Drizzle SQL ORDER BY expressions.
 *
 * Validates column names against `tableColumns`. Supports nulls ordering via raw SQL
 * (`NULLS FIRST` / `NULLS LAST`) appended to the asc/desc expression.
 *
 * @param tableColumns - Column map from `getTableColumns(table)`
 * @param sorts - Client sort array from `parseLoadSubsetOptions`
 * @param tableName - Table name string for Sentry `extra` context
 * @returns Array of Drizzle SQL ORDER BY expressions
 */
export function buildDrizzleOrderFromSorts(
	tableColumns: TableColumns,
	sorts: SyncSort[],
	tableName = 'unknown',
): SQL[] {
	if (sorts.length === 0) return []

	const orderBys: SQL[] = []

	for (const sort of sorts) {
		const columnName = sort.field[0]
		if (!columnName) {
			Sentry.captureException(new Error(`Sync sort field path is empty`), {
				tags: { error_type: 'sync_sort_validation' },
				extra: { tableName, field: sort.field },
			})
			throw new SyncFilterError(`Sort field path must have at least one segment`)
		}

		const column = tableColumns[columnName]
		if (!column) {
			Sentry.captureException(new Error(`Unknown sync sort column: ${columnName}`), {
				tags: { error_type: 'sync_sort_validation' },
				extra: { columnName, tableName },
			})
			throw new SyncFilterError(`Unknown sort column: ${columnName}`)
		}

		// Build the direction expression, then append NULLS FIRST/LAST via raw SQL
		const directionExpr = sort.direction === 'asc' ? asc(column) : desc(column)
		const nullsClause = sort.nulls === 'first' ? 'NULLS FIRST' : 'NULLS LAST'

		// Wrap with raw SQL to append NULLS FIRST/LAST
		orderBys.push(sql`${directionExpr} ${sql.raw(nullsClause)}`)
	}

	return orderBys
}

/**
 * Error class for sync filter/sort validation failures.
 * Caught at the handler level to return BAD_REQUEST responses.
 */
export class SyncFilterError extends Data.TaggedError('SyncFilterError')<{ readonly message: string }> {
	constructor(message: string) {
		super({ message })
	}
}

export interface SyncQueryParts {
	readonly clientWhere: SQL | undefined
	readonly orderBy: SQL[]
}

export const parseSyncQuery = Effect.fn('sync.parse_query')(function* (input: {
	readonly columns: TableColumns
	readonly where: WhereExpression | undefined
	readonly sorts: SyncSort[]
	readonly tableName: string
}) {
	return yield* Effect.try({
		try: (): SyncQueryParts => ({
			clientWhere: buildDrizzleWhereFromExpression(input.columns, input.where, input.tableName),
			orderBy: buildDrizzleOrderFromSorts(input.columns, input.sorts, input.tableName),
		}),
		catch: (cause) => {
			if (cause instanceof SyncFilterError) return cause
			throw cause
		},
	})
})

/**
 * Recursively walks a WhereExpression AST looking for any comparison node
 * where field[0] matches one of the given field names.
 */
export function hasFieldComparison(expression: WhereExpression, fields: string[]): boolean {
	switch (expression.type) {
		case 'comparison':
			return fields.includes(expression.field[0] ?? '')
		case 'and':
		case 'or':
			return expression.conditions.some((c) => hasFieldComparison(c, fields))
		case 'not':
			return hasFieldComparison(expression.condition, fields)
		default: {
			const _exhaustive: never = expression
			return false
		}
	}
}

/**
 * Validates that a where expression contains at least one comparison
 * referencing a required scope field. Throws SyncFilterError if not.
 */
export function requireScopeFields(
	where: WhereExpression | undefined,
	requiredFields: string[],
	tableName: string,
): void {
	if (!where || !hasFieldComparison(where, requiredFields)) {
		throw new SyncFilterError(`${tableName} sync requires a filter on one of: ${requiredFields.join(', ')}`)
	}
}
