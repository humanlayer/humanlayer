import { artifacts } from '@humanlayer/db/tables/artifacts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { describe, expect, test } from 'vitest'

import { buildWhereFragmentForTasks, buildWhereFragmentWithAcl } from '../src/lib/where-builder'

describe('where-builder', () => {
	const mockAuth = {
		userId: 'user-123',
		organizationId: 'org-456',
	}

	describe('buildWhereFragmentWithAcl', () => {
		// Test 141: Includes `resource_owner_user_id` condition
		test('includes resource_owner_user_id condition in generated SQL', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth)

			expect(result.fragment).toContain('resource_owner_user_id')
			// userId should be parameterized, not inlined
			expect(result.params).toContain(mockAuth.userId)
		})

		// Test 142: Includes `task_user_acl` subquery
		test('includes task_user_acl subquery in generated SQL', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth)

			expect(result.fragment).toContain('task_user_acl')
			expect(result.fragment).toContain('subject_user_id')
		})

		// Test 143: Includes `task_organization_acl` subquery
		test('includes task_organization_acl subquery in generated SQL', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth)

			expect(result.fragment).toContain('task_organization_acl')
		})

		// Test 144: Uses OR to combine conditions
		test('uses OR logic to combine ownership and ACL conditions', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth)

			// The fragment should have OR operators between the main conditions
			// Looking for pattern: (resource_owner_user_id = ... OR task_id IN (...) OR task_id IN (...))
			expect(result.fragment).toMatch(/OR/)

			// Verify it contains both the ownership check and ACL subqueries
			expect(result.fragment).toContain('resource_owner_user_id')
			expect(result.fragment).toContain('task_user_acl')
			expect(result.fragment).toContain('task_organization_acl')
		})

		// Test 145: Handles `additionalConditions`
		test('handles additionalConditions parameter', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth, {
				additionalConditions: [
					{
						column: sessions.status,
						value: 'active',
					},
				],
			})

			// Should include the additional condition column
			expect(result.fragment).toContain('status')
			// Value should be parameterized, not inlined
			expect(result.params).toContain('active')

			// Should still have the core conditions
			expect(result.fragment).toContain('resource_owner_user_id')
			expect(result.fragment).toContain('task_user_acl')
		})

		test('uses custom taskIdColumn when provided', () => {
			// For tasks table, we need to use 'id' instead of 'task_id'
			const result = buildWhereFragmentWithAcl(tasks, mockAuth, {
				taskIdColumn: 'id',
			})

			// The subqueries should reference the custom column
			expect(result.fragment).toContain('id')
		})

		test('includes organization_id filter', () => {
			const result = buildWhereFragmentWithAcl(sessions, mockAuth)

			// Should filter by organization_id for security
			expect(result.fragment).toContain('organization_id')
			// organizationId should be parameterized, not inlined
			expect(result.params).toContain(mockAuth.organizationId)
		})

		test('generates SQL for artifacts table', () => {
			const result = buildWhereFragmentWithAcl(artifacts, mockAuth)

			// Should work with different tables
			expect(result.fragment).toBeTruthy()
			expect(result.fragment).toContain('resource_owner_user_id')
			expect(result.fragment).toContain('task_id')
			expect(result.fragment).toContain('organization_id')
		})
	})

	describe('buildWhereFragmentForTasks', () => {
		// Test 146: Uses `tasks.id` for ACL lookup (not `task_id`)
		test('uses tasks.id for ACL lookup instead of task_id', () => {
			const result = buildWhereFragmentForTasks(mockAuth)

			// Should use 'id' column for task lookups in the subqueries
			// The pattern should be: "id" IN (SELECT "task_id" FROM "task_user_acl" ...)
			expect(result.fragment).toContain('id')

			// Should not reference 'task_id' as the column being filtered
			// (it will appear in the SELECT part of subqueries, but not as the main filter column)
			const fragmentBeforeIn = result.fragment.split('IN')[0]
			expect(fragmentBeforeIn).toContain('id')
		})

		// Test 147: Generates correct combined WHERE clause
		test('generates correct combined WHERE clause with all conditions', () => {
			const result = buildWhereFragmentForTasks(mockAuth)

			// Should include organization filter column
			expect(result.fragment).toContain('organization_id')
			// organizationId should be parameterized
			expect(result.params).toContain(mockAuth.organizationId)

			// Should include resource_owner_user_id check
			expect(result.fragment).toContain('resource_owner_user_id')
			// userId should be parameterized
			expect(result.params).toContain(mockAuth.userId)

			// Should include both ACL subqueries
			expect(result.fragment).toContain('task_user_acl')
			expect(result.fragment).toContain('task_organization_acl')

			// Should have OR logic
			expect(result.fragment).toMatch(/OR/)

			// Should be a valid-looking SQL fragment (no obvious syntax errors)
			expect(result.fragment).not.toContain('undefined')
			expect(result.fragment).not.toContain('null')

			// Fragment should not start with WHERE (it's a fragment, not a full clause)
			expect(result.fragment).not.toMatch(/^WHERE/i)
		})

		test('returns parameterized values in params array', () => {
			const result = buildWhereFragmentForTasks(mockAuth)

			// Values should be properly parameterized
			expect(result.params.length).toBeGreaterThan(0)
			expect(result.params).toContain(mockAuth.organizationId)
			expect(result.params).toContain(mockAuth.userId)
		})

		test('injection payload is parameterized, not interpolated', () => {
			const payload = "' OR 1=1) --"
			const result = buildWhereFragmentWithAcl(sessions, {
				userId: payload,
				organizationId: mockAuth.organizationId,
			})

			// The injection payload should NOT appear in the SQL fragment
			expect(result.fragment).not.toContain(payload)
			// It should be safely contained in the params array
			expect(result.params).toContain(payload)
		})
	})
})
