import { describe, expect, test } from 'vitest'

import {
	coerceBigIntFields,
	createSyncQueryFn,
	intermediateRepresentationToWhereExpression,
	irToSorts,
} from '../src/sync-query-helpers.ts'

// ============================================================================
// Test helpers: IR expression node builders matching TanStack DB's internal format
// ============================================================================

function ref(path: string[]): { type: 'ref'; path: string[] } {
	return { type: 'ref', path }
}
function val<T>(value: T): { type: 'val'; value: T } {
	return { type: 'val', value }
}
function func(name: string, ...args: unknown[]): { type: 'func'; name: string; args: unknown[] } {
	return { type: 'func', name, args }
}

// ============================================================================
// intermediateRepresentationToWhereExpression
// ============================================================================

describe('intermediateRepresentationToWhereExpression', () => {
	test('undefined input returns undefined', () => {
		expect(intermediateRepresentationToWhereExpression(undefined)).toBeUndefined()
	})

	test('null input returns undefined', () => {
		expect(intermediateRepresentationToWhereExpression(null)).toBeUndefined()
	})

	test('eq comparison', () => {
		const ir = func('eq', ref(['status']), val('active'))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['status'],
			operator: 'eq',
			value: 'active',
		})
	})

	test('gt comparison', () => {
		const ir = func('gt', ref(['count']), val(5))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['count'],
			operator: 'gt',
			value: 5,
		})
	})

	test('gte comparison', () => {
		const ir = func('gte', ref(['count']), val(5))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['count'],
			operator: 'gte',
			value: 5,
		})
	})

	test('lt comparison', () => {
		const ir = func('lt', ref(['count']), val(10))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['count'],
			operator: 'lt',
			value: 10,
		})
	})

	test('lte comparison', () => {
		const ir = func('lte', ref(['count']), val(10))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['count'],
			operator: 'lte',
			value: 10,
		})
	})

	test('in comparison', () => {
		const ir = func('in', ref(['status']), val(['active', 'pending']))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['status'],
			operator: 'in',
			value: ['active', 'pending'],
		})
	})

	test('like comparison', () => {
		const ir = func('like', ref(['name']), val('%test%'))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['name'],
			operator: 'like',
			value: '%test%',
		})
	})

	test('ilike comparison', () => {
		const ir = func('ilike', ref(['name']), val('%test%'))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['name'],
			operator: 'ilike',
			value: '%test%',
		})
	})

	test('isNull comparison', () => {
		const ir = func('isNull', ref(['count']))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['count'],
			operator: 'isNull',
		})
	})

	test('isUndefined comparison', () => {
		const ir = func('isUndefined', ref(['value']))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['value'],
			operator: 'isUndefined',
		})
	})

	test('and(eq, eq)', () => {
		const ir = func('and', func('eq', ref(['status']), val('active')), func('eq', ref(['archived']), val(false)))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'and',
			conditions: [
				{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
				{ type: 'comparison', field: ['archived'], operator: 'eq', value: false },
			],
		})
	})

	test('or(eq, eq)', () => {
		const ir = func('or', func('eq', ref(['status']), val('active')), func('eq', ref(['status']), val('pending')))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'or',
			conditions: [
				{ type: 'comparison', field: ['status'], operator: 'eq', value: 'active' },
				{ type: 'comparison', field: ['status'], operator: 'eq', value: 'pending' },
			],
		})
	})

	test('not(eq) optimizes to not_eq comparison', () => {
		const ir = func('not', func('eq', ref(['archived']), val(true)))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['archived'],
			operator: 'not_eq',
			value: true,
		})
	})

	test('not(and(...)) produces a not node (not optimized)', () => {
		const ir = func('not', func('and', func('eq', ref(['a']), val(1)), func('eq', ref(['b']), val(2))))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'not',
			condition: {
				type: 'and',
				conditions: [
					{ type: 'comparison', field: ['a'], operator: 'eq', value: 1 },
					{ type: 'comparison', field: ['b'], operator: 'eq', value: 2 },
				],
			},
		})
	})

	test('nested and(or(...), eq(...))', () => {
		const ir = func(
			'and',
			func('or', func('eq', ref(['status']), val('active')), func('eq', ref(['status']), val('pending'))),
			func('eq', ref(['archived']), val(false)),
		)
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
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
	})

	test('unknown operator returns undefined', () => {
		const ir = func('upper', ref(['name']))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toBeUndefined()
	})

	test('single-child and unwraps to the child', () => {
		const ir = func('and', func('eq', ref(['status']), val('active')))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['status'],
			operator: 'eq',
			value: 'active',
		})
	})

	test('single-child or unwraps to the child', () => {
		const ir = func('or', func('eq', ref(['status']), val('active')))
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'comparison',
			field: ['status'],
			operator: 'eq',
			value: 'active',
		})
	})

	test('or(ilike, ilike, ilike) — CommandPalette search pattern', () => {
		const ir = func(
			'or',
			func('ilike', ref(['title']), val('%search%')),
			func('ilike', ref(['summary']), val('%search%')),
			func('ilike', ref(['prompt']), val('%search%')),
		)
		expect(intermediateRepresentationToWhereExpression(ir as any)).toEqual({
			type: 'or',
			conditions: [
				{ type: 'comparison', field: ['title'], operator: 'ilike', value: '%search%' },
				{ type: 'comparison', field: ['summary'], operator: 'ilike', value: '%search%' },
				{ type: 'comparison', field: ['prompt'], operator: 'ilike', value: '%search%' },
			],
		})
	})
})

// ============================================================================
// irToSorts
// ============================================================================

describe('irToSorts', () => {
	test('undefined input returns empty array', () => {
		expect(irToSorts(undefined)).toEqual([])
	})

	test('null input returns empty array', () => {
		expect(irToSorts(null)).toEqual([])
	})

	test('single sort asc nulls last', () => {
		const orderBy = [
			{
				expression: ref(['createdAt']),
				compareOptions: { direction: 'asc', nulls: 'last' },
			},
		]
		expect(irToSorts(orderBy as any)).toEqual([{ field: ['createdAt'], direction: 'asc', nulls: 'last' }])
	})

	test('single sort desc nulls first', () => {
		const orderBy = [
			{
				expression: ref(['updatedAt']),
				compareOptions: { direction: 'desc', nulls: 'first' },
			},
		]
		expect(irToSorts(orderBy as any)).toEqual([{ field: ['updatedAt'], direction: 'desc', nulls: 'first' }])
	})

	test('multiple sorts', () => {
		const orderBy = [
			{
				expression: ref(['status']),
				compareOptions: { direction: 'asc', nulls: 'last' },
			},
			{
				expression: ref(['createdAt']),
				compareOptions: { direction: 'desc', nulls: 'first' },
			},
		]
		expect(irToSorts(orderBy as any)).toEqual([
			{ field: ['status'], direction: 'asc', nulls: 'last' },
			{ field: ['createdAt'], direction: 'desc', nulls: 'first' },
		])
	})
})

// ============================================================================
// createSyncQueryFn
// ============================================================================

const noopTracker = { recordQueryError: () => {}, recordQuerySuccess: () => {} }
const noopOnError = () => {}

describe('createSyncQueryFn', () => {
	test('calls apiFn with empty input when no loadSubsetOptions', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		await queryFn({ meta: undefined })

		expect(calls).toHaveLength(1)
		expect(calls[0]).toEqual({ where: undefined, sorts: [] })
	})

	test('serializes where expression into input', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		const where = func('eq', ref(['status']), val('active'))
		await queryFn({
			meta: {
				loadSubsetOptions: { where: where as any },
			},
		})

		expect(calls[0]?.where).toEqual({
			type: 'comparison',
			field: ['status'],
			operator: 'eq',
			value: 'active',
		})
	})

	test('serializes orderBy into sorts', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		const orderBy = [
			{
				expression: ref(['createdAt']),
				compareOptions: { direction: 'desc', nulls: 'last' },
			},
		]
		await queryFn({
			meta: {
				loadSubsetOptions: { orderBy: orderBy as any },
			},
		})

		expect(calls[0]?.sorts).toEqual([{ field: ['createdAt'], direction: 'desc', nulls: 'last' }])
	})

	test('includes limit when provided', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		await queryFn({
			meta: {
				loadSubsetOptions: { limit: 50 },
			},
		})

		expect(calls[0]?.limit).toBe(50)
	})

	test('does not include limit when not provided', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		await queryFn({ meta: {} })

		expect('limit' in (calls[0] ?? {})).toBe(false)
	})

	test('merges extraInput into the request', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			return { rows: [] }
		}

		const queryFn = createSyncQueryFn(apiFn, { hostId: 'host-123' }, noopTracker, 'test', noopOnError)
		await queryFn({ meta: undefined })

		expect(calls[0]?.hostId).toBe('host-123')
	})

	test('returns the api response', async () => {
		const expectedData = { rows: [{ id: '1', status: 'active' }] }
		const apiFn = async () => expectedData

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'test', noopOnError)
		const result = await queryFn({ meta: undefined })

		expect(result).toEqual(expectedData)
	})

	test('pages an unlimited metadata query past the 10,000-row server limit', async () => {
		const calls: Array<Record<string, unknown>> = []
		const apiFn = async (input: Record<string, unknown>) => {
			calls.push(input)
			const offset = input.offset as number
			return {
				rows:
					offset === 0
						? Array.from({ length: 10_000 }, (_, index) => ({ id: `artifact-${index}` }))
						: offset === 10_000
							? [{ id: 'eligible-plan-document' }]
							: [],
			}
		}

		const queryFn = createSyncQueryFn(apiFn, undefined, noopTracker, 'artifactsMetadata', noopOnError, {
			pageSize: 10_000,
			stableSorts: [{ field: ['id'], direction: 'asc', nulls: 'last' }],
		})
		const result = await queryFn({ meta: undefined })

		expect(result.rows).toHaveLength(10_001)
		expect(result.rows.at(-1)).toEqual({ id: 'eligible-plan-document' })
		expect(calls).toEqual([
			{ where: undefined, sorts: [{ field: ['id'], direction: 'asc', nulls: 'last' }], limit: 10_000, offset: 0 },
			{
				where: undefined,
				sorts: [{ field: ['id'], direction: 'asc', nulls: 'last' }],
				limit: 10_000,
				offset: 10_000,
			},
		])
	})
})

// ============================================================================
// coerceBigIntFields
// ============================================================================

describe('coerceBigIntFields', () => {
	test('coerces string-encoded bigint fields to BigInt', () => {
		const rows = [{ id: '1', txId: '1771621345994', name: 'test' }]
		const result = coerceBigIntFields(rows, ['txId'])
		// Cast to unknown first since TypeScript knows the field was originally string
		expect(result[0]?.txId as unknown).toBe(BigInt('1771621345994'))
		expect(result[0]?.name).toBe('test') // non-coerced field unchanged
	})

	test('coerces multiple fields', () => {
		const rows = [{ id: '1', txId: '123456', offset: '789' }]
		const result = coerceBigIntFields(rows, ['txId', 'offset'])
		expect(result[0]?.txId as unknown).toBe(BigInt('123456'))
		expect(result[0]?.offset as unknown).toBe(BigInt('789'))
	})

	test('leaves non-string fields unchanged', () => {
		const rows = [{ id: '1', count: 42, txId: '999' }]
		const result = coerceBigIntFields(rows, ['txId'])
		expect(result[0]?.count).toBe(42) // number, not string — left alone
		expect(result[0]?.txId as unknown).toBe(BigInt('999'))
	})

	test('skips empty string fields', () => {
		const rows = [{ id: '1', txId: '' }]
		const result = coerceBigIntFields(rows, ['txId'])
		// Empty strings are not valid BigInt — skip them
		expect(result[0]?.txId).toBe('')
	})

	test('does not mutate original rows', () => {
		const original = [{ id: '1', txId: '123' }]
		coerceBigIntFields(original, ['txId'])
		expect(original[0]?.txId).toBe('123') // original unchanged
	})

	test('handles empty rows array', () => {
		const result = coerceBigIntFields([], ['txId'])
		expect(result).toEqual([])
	})

	test('handles multiple rows', () => {
		const rows = [
			{ id: '1', txId: '100' },
			{ id: '2', txId: '200' },
		]
		const result = coerceBigIntFields(rows, ['txId'])
		expect(result[0]?.txId as unknown).toBe(BigInt('100'))
		expect(result[1]?.txId as unknown).toBe(BigInt('200'))
	})
})
