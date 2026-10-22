import z from 'zod/v4'

// =============================================================================
// Recursive WhereExpression wire format
// =============================================================================

/**
 * Recursive where-expression tree for server-side filter push-down.
 * Four node types: comparison (leaf), and, or, not.
 * Maps 1:1 to TanStack DB's IR tree and Drizzle's SQL builders.
 */
export type WhereExpression =
	| { type: 'comparison'; field: string[]; operator: string; value?: unknown }
	| { type: 'and'; conditions: WhereExpression[] }
	| { type: 'or'; conditions: WhereExpression[] }
	| { type: 'not'; condition: WhereExpression }

const WhereComparisonSchema = z.object({
	type: z.literal('comparison'),
	field: z.array(z.string()).min(1),
	operator: z.string(),
	value: z.any().optional(),
})

export const WhereExpressionSchema: z.ZodType<WhereExpression> = z.lazy(() =>
	z.discriminatedUnion('type', [
		WhereComparisonSchema,
		z.object({ type: z.literal('and'), conditions: z.array(WhereExpressionSchema) }),
		z.object({ type: z.literal('or'), conditions: z.array(WhereExpressionSchema) }),
		z.object({ type: z.literal('not'), condition: WhereExpressionSchema }),
	]),
)

/**
 * Represents a single sort directive sent by the client.
 * `field` is an array of path segments.
 * `direction` is 'asc' or 'desc'.
 * `nulls` controls NULL ordering: 'first' or 'last'.
 */
export const SyncSortSchema = z.object({
	field: z.array(z.string()),
	direction: z.enum(['asc', 'desc']),
	nulls: z.enum(['first', 'last']),
})

/**
 * Standard input schema for all sync routes.
 * Uses recursive WhereExpression tree for server-side filter push-down.
 */
export const SyncInputSchema = z.object({
	where: WhereExpressionSchema.optional(),
	sorts: z.array(SyncSortSchema).default([]),
	limit: z.number().int().positive().max(10000).optional(),
	offset: z.number().int().nonnegative().optional(),
})

export type SyncSort = z.infer<typeof SyncSortSchema>
export type SyncInput = z.infer<typeof SyncInputSchema>

/**
 * Factory for sync output schemas. All sync routes return `{ rows: Array<Row> }`.
 * The `rowSchema` should be the select schema for the target table.
 */
export function createSyncOutputSchema<T extends z.ZodTypeAny>(rowSchema: T) {
	return z.object({ rows: z.array(rowSchema) })
}
