import { SyncSortSchema, type WhereExpression } from '@humanlayer/riptide-api-contract/api/sync/shared-schemas'
import { getTableColumns } from 'drizzle-orm'
import { boolean, integer, pgTable, QueryBuilder, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, test } from 'vitest'

import {
	buildApprovalsSyncWhere,
	buildApprovalsSyncWhereV2,
	buildArtifactCommentsSyncWhere,
	buildArtifactCommentsSyncWhereV2,
	buildArtifactsSyncWhere,
	buildArtifactsSyncWhereV2,
	buildConversationEventsSyncWhere,
	buildConversationEventsSyncWhereV2,
	buildSessionsSyncWhere,
	buildSessionsSyncWhereV2,
	buildTasksSyncWhere,
	buildTasksSyncWhereV2,
} from '../../src/db/sync-auth'
import {
	buildDrizzleOrderFromSorts,
	buildDrizzleWhereFromExpression,
	hasFieldComparison,
	requireScopeFields,
	SyncFilterError,
} from '../../src/db/sync-filters'
import { requireExternalTestServices } from '../utils/external-test-services'

await requireExternalTestServices()

// Minimal test table with common column types
const testTable = pgTable('test_items', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	status: text('status').notNull(),
	count: integer('count'),
	archived: boolean('archived'),
	created_at: timestamp('created_at'),
})

const columns = getTableColumns(testTable)
const sqlClient = postgres(process.env.DATABASE_URL!, { max: 1 })
const syncAuthDb = drizzle(sqlClient)

/**
 * Helper: render a WhereExpression via buildDrizzleWhereFromExpression
 */
function renderExpressionWhere(expression: WhereExpression | undefined): string {
	const condition = buildDrizzleWhereFromExpression(columns, expression, 'test_items')
	if (!condition) return ''
	const qb = new QueryBuilder()
	const query = qb.select().from(testTable).where(condition).toSQL()
	const idx = query.sql.indexOf(' where ')
	return idx >= 0 ? query.sql.slice(idx + 7) : query.sql
}

describe('buildDrizzleWhereFromExpression', () => {
	test('returns undefined for undefined expression', () => {
		expect(buildDrizzleWhereFromExpression(columns, undefined, 'test')).toBeUndefined()
	})

	describe('comparison nodes', () => {
		test('eq', () => {
			const sql = renderExpressionWhere({
				type: 'comparison',
				field: ['status'],
				operator: 'eq',
				value: 'active',
			})
			expect(sql).toContain('"status" = ')
		})

		test('ilike', () => {
			const sql = renderExpressionWhere({
				type: 'comparison',
				field: ['name'],
				operator: 'ilike',
				value: '%test%',
			})
			expect(sql).toContain('"name" ilike ')
		})

		test('like', () => {
			const sql = renderExpressionWhere({
				type: 'comparison',
				field: ['name'],
				operator: 'like',
				value: '%test%',
			})
			expect(sql).toContain('"name" like ')
		})

		test('isNull', () => {
			const sql = renderExpressionWhere({
				type: 'comparison',
				field: ['count'],
				operator: 'isNull',
			})
			expect(sql).toContain('"count" is null')
		})
	})

	describe('logical nodes', () => {
		test('and with two comparisons', () => {
			const sql = renderExpressionWhere({
				type: 'and',
				conditions: [
					{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
					{ type: 'comparison', field: ['archived'], operator: 'eq', value: false },
				],
			})
			expect(sql).toContain('"status" = ')
			expect(sql).toContain('"archived" = ')
			expect(sql).toContain(' and ')
		})

		test('or with two comparisons', () => {
			const sql = renderExpressionWhere({
				type: 'or',
				conditions: [
					{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
					{ type: 'comparison', field: ['status'], operator: 'eq', value: 'pending' },
				],
			})
			expect(sql).toContain(' or ')
		})

		test('not wrapping a comparison', () => {
			const sql = renderExpressionWhere({
				type: 'not',
				condition: { type: 'comparison', field: ['archived'], operator: 'eq', value: true },
			})
			expect(sql).toContain('not')
			expect(sql).toContain('"archived" = ')
		})

		test('nested and(or(...), eq(...))', () => {
			const sql = renderExpressionWhere({
				type: 'and',
				conditions: [
					{
						type: 'or',
						conditions: [
							{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
							{ type: 'comparison', field: ['status'], operator: 'eq', value: 'pending' },
						],
					},
					{ type: 'comparison', field: ['archived'], operator: 'eq', value: false },
				],
			})
			expect(sql).toContain(' and ')
			expect(sql).toContain(' or ')
		})
	})

	describe('edge cases', () => {
		test('empty and conditions returns undefined', () => {
			expect(buildDrizzleWhereFromExpression(columns, { type: 'and', conditions: [] }, 'test')).toBeUndefined()
		})

		test('empty or conditions returns undefined', () => {
			expect(buildDrizzleWhereFromExpression(columns, { type: 'or', conditions: [] }, 'test')).toBeUndefined()
		})

		test('single-element and returns condition directly', () => {
			const result = buildDrizzleWhereFromExpression(
				columns,
				{
					type: 'and',
					conditions: [{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' }],
				},
				'test',
			)
			expect(result).toBeDefined()
			const sql = renderExpressionWhere({
				type: 'and',
				conditions: [{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' }],
			})
			expect(sql).not.toContain(' and ')
		})
	})

	describe('error paths', () => {
		test('unknown column throws SyncFilterError', () => {
			expect(() =>
				buildDrizzleWhereFromExpression(
					columns,
					{ type: 'comparison', field: ['nonexistent'], operator: 'eq', value: 'x' },
					'test',
				),
			).toThrow(SyncFilterError)
		})

		test('unsupported operator throws SyncFilterError', () => {
			expect(() =>
				buildDrizzleWhereFromExpression(
					columns,
					{ type: 'comparison', field: ['status'], operator: 'bogus', value: 'x' },
					'test',
				),
			).toThrow(SyncFilterError)
		})

		test('depth limit exceeded throws SyncFilterError', () => {
			// Build a deeply nested expression that exceeds MAX_EXPRESSION_DEPTH (10)
			let expr: WhereExpression = { type: 'comparison', field: ['status'], operator: 'eq', value: 'x' }
			for (let i = 0; i < 12; i++) {
				expr = { type: 'and', conditions: [expr] }
			}
			expect(() => buildDrizzleWhereFromExpression(columns, expr, 'test')).toThrow('exceeds maximum depth')
		})

		test('empty field path throws SyncFilterError', () => {
			expect(() =>
				buildDrizzleWhereFromExpression(
					columns,
					{ type: 'comparison', field: [], operator: 'eq', value: 'x' },
					'test',
				),
			).toThrow(SyncFilterError)
		})
	})
})

describe('buildDrizzleOrderFromSorts', () => {
	describe('returns empty array for empty sorts', () => {
		test('empty array', () => {
			expect(buildDrizzleOrderFromSorts(columns, [])).toEqual([])
		})
	})

	describe('direction', () => {
		test('asc', () => {
			const result = buildDrizzleOrderFromSorts(columns, [{ field: ['name'], direction: 'asc', nulls: 'last' }])
			expect(result).toHaveLength(1)
		})

		test('desc', () => {
			const result = buildDrizzleOrderFromSorts(columns, [{ field: ['name'], direction: 'desc', nulls: 'last' }])
			expect(result).toHaveLength(1)
		})
	})

	describe('multiple sorts', () => {
		test('preserves order', () => {
			const result = buildDrizzleOrderFromSorts(columns, [
				{ field: ['status'], direction: 'asc', nulls: 'last' },
				{ field: ['created_at'], direction: 'desc', nulls: 'first' },
			])
			expect(result).toHaveLength(2)
		})
	})

	describe('error paths', () => {
		test('empty field path throws SyncFilterError', () => {
			expect(() => buildDrizzleOrderFromSorts(columns, [{ field: [], direction: 'asc', nulls: 'last' }])).toThrow(
				SyncFilterError,
			)
		})

		test('unknown column throws SyncFilterError', () => {
			expect(() =>
				buildDrizzleOrderFromSorts(columns, [{ field: ['nonexistent'], direction: 'asc', nulls: 'last' }]),
			).toThrow(SyncFilterError)
		})

		test('invalid direction is rejected at the sync input boundary', () => {
			expect(SyncSortSchema.safeParse({ field: ['name'], direction: 'sideways', nulls: 'last' }).success).toBe(
				false,
			)
		})
	})
})

describe('requireScopeFields', () => {
	test('rejects undefined where', () => {
		expect(() => requireScopeFields(undefined, ['session_id'], 'conversation_events')).toThrow(SyncFilterError)
	})

	test('rejects where with no matching scope field', () => {
		expect(() =>
			requireScopeFields(
				{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
				['session_id', 'task_id'],
				'conversation_events',
			),
		).toThrow(SyncFilterError)
	})

	test('error message includes table name and required fields', () => {
		expect(() => requireScopeFields(undefined, ['session_id', 'task_id', 'id'], 'conversation_events')).toThrow(
			'conversation_events sync requires a filter on one of: session_id, task_id, id',
		)
	})

	test('passes with direct comparison on scope field', () => {
		expect(() =>
			requireScopeFields(
				{ type: 'comparison', field: ['session_id'], operator: 'eq', value: 'abc' },
				['session_id', 'task_id'],
				'conversation_events',
			),
		).not.toThrow()
	})

	test('passes with scope field nested inside and', () => {
		expect(() =>
			requireScopeFields(
				{
					type: 'and',
					conditions: [
						{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
						{ type: 'comparison', field: ['session_id'], operator: 'eq', value: 'abc' },
					],
				},
				['session_id'],
				'conversation_events',
			),
		).not.toThrow()
	})

	test('passes with scope field nested inside or', () => {
		expect(() =>
			requireScopeFields(
				{
					type: 'or',
					conditions: [
						{ type: 'comparison', field: ['task_id'], operator: 'eq', value: 'xyz' },
						{ type: 'comparison', field: ['status'], operator: 'eq', value: 'done' },
					],
				},
				['session_id', 'task_id'],
				'conversation_events',
			),
		).not.toThrow()
	})

	test('passes with scope field nested inside not', () => {
		expect(() =>
			requireScopeFields(
				{
					type: 'not',
					condition: { type: 'comparison', field: ['session_id'], operator: 'eq', value: 'abc' },
				},
				['session_id'],
				'conversation_events',
			),
		).not.toThrow()
	})

	test('passes when any one of multiple required fields matches', () => {
		expect(() =>
			requireScopeFields(
				{ type: 'comparison', field: ['id'], operator: 'eq', value: 'some-id' },
				['session_id', 'task_id', 'id'],
				'conversation_events',
			),
		).not.toThrow()
	})
})

describe('sync auth v1 vs v2 builders', () => {
	test('sessions v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildSessionsSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildSessionsSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})

	test('tasks v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildTasksSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildTasksSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})

	test('conversation events v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildConversationEventsSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildConversationEventsSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})

	test('approvals v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildApprovalsSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildApprovalsSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})

	test('artifacts v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildArtifactsSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildArtifactsSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})

	test('artifact comments v2 drops ACL subqueries while preserving org filter', () => {
		const v1 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildArtifactCommentsSyncWhere({ organizationId: 'org', userId: 'user' }, syncAuthDb))
			.toSQL().sql
		const v2 = new QueryBuilder()
			.select()
			.from(testTable)
			.where(buildArtifactCommentsSyncWhereV2({ organizationId: 'org', userId: 'user' }))
			.toSQL().sql
		expect(v1).toContain('task_user_acl')
		expect(v2).toContain('organization_id')
		expect(v2).not.toContain('task_user_acl')
	})
})

describe('hasFieldComparison', () => {
	test('returns false for comparison on non-matching field', () => {
		expect(
			hasFieldComparison({ type: 'comparison', field: ['status'], operator: 'eq', value: 'x' }, ['session_id']),
		).toBe(false)
	})

	test('returns true for comparison on matching field', () => {
		expect(
			hasFieldComparison({ type: 'comparison', field: ['session_id'], operator: 'eq', value: 'x' }, [
				'session_id',
			]),
		).toBe(true)
	})

	test('walks deeply nested structures', () => {
		expect(
			hasFieldComparison(
				{
					type: 'and',
					conditions: [
						{
							type: 'or',
							conditions: [
								{
									type: 'not',
									condition: { type: 'comparison', field: ['task_id'], operator: 'eq', value: 'x' },
								},
							],
						},
					],
				},
				['task_id'],
			),
		).toBe(true)
	})
})
