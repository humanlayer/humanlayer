import { describe, expect, it } from 'vitest'

import { extractIssueId, getStagedTaskFiles } from './git'

describe('extractIssueId', () => {
	it('extracts issue ID from branch name', () => {
		expect(extractIssueId('dexter/ENG-1234-fix-ui')).toBe('ENG-1234')
		expect(extractIssueId('eng-1234-fix-ui')).toBe('ENG-1234')
		expect(extractIssueId('B2BPROD-206')).toBe('B2BPROD-206')
	})

	it('extracts issue ID from task directory path', () => {
		expect(extractIssueId('repos/syncopate/tasks/eng-1234-description/file.md')).toBe('ENG-1234')
		expect(extractIssueId('tasks/ll-24-something/research.md')).toBe('LL-24')
	})

	it('returns null for non-matching strings', () => {
		expect(extractIssueId('dexter')).toBeNull()
		expect(extractIssueId('linear-cli-refactor')).toBeNull()
	})

	it('uppercases the result', () => {
		expect(extractIssueId('eng-1234')).toBe('ENG-1234')
	})
})

describe('getStagedTaskFiles', () => {
	it('returns empty array when not in git repo', async () => {
		const result = await getStagedTaskFiles('/nonexistent/path')
		expect(result).toEqual([])
	})

	// Note: Full integration testing requires mocking git or using a test repo
	// These tests verify the function doesn't throw and handles edge cases
	it('handles empty prefix', async () => {
		// Should not throw
		const result = await getStagedTaskFiles(process.cwd(), '')
		expect(Array.isArray(result)).toBe(true)
	})
})

describe('task file pattern matching', () => {
	// Test the regex pattern directly since getStagedTaskFiles is hard to integration test
	it('matches correct task file patterns with prefix', () => {
		const prefix = 'repos/syncopate/'
		const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}tasks/`)

		// Should match
		expect(pattern.test('repos/syncopate/tasks/eng-1234/plan.md')).toBe(true)
		expect(pattern.test('repos/syncopate/tasks/ll-24-something/research.md')).toBe(true)

		// Should NOT match
		expect(pattern.test('repos/other/tasks/eng-1234/plan.md')).toBe(false)
		expect(pattern.test('repos/syncopate/shared/plans/plan.md')).toBe(false)
		expect(pattern.test('some/other/path.md')).toBe(false)
	})

	it('matches correct task file patterns without prefix', () => {
		const pattern = /^tasks\//

		// Should match
		expect(pattern.test('tasks/eng-1234/plan.md')).toBe(true)

		// Should NOT match
		expect(pattern.test('other/tasks/eng-1234/plan.md')).toBe(false)
	})
})
