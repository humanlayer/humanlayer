import { describe, expect, test } from 'vitest'

import { GitHubIssueInputSchema, parseGitHubIssueInput } from './github-issue-input'

describe('parseGitHubIssueInput', () => {
	test.each([
		['482', { ok: true, issueNumber: 482, repositoryFullName: null }],
		[' 482 ', { ok: true, issueNumber: 482, repositoryFullName: null }],
		['https://github.com/acme/web/issues/482', { ok: true, issueNumber: 482, repositoryFullName: 'acme/web' }],
		['https://github.com/acme/web/issues/482/', { ok: true, issueNumber: 482, repositoryFullName: 'acme/web' }],
	] as const)('parses %s', (input, expected) => {
		expect(parseGitHubIssueInput(input)).toEqual(expected)
	})

	test.each([
		'',
		'0',
		'-1',
		'owner/repo#1',
		'https://example.com/acme/web/issues/1',
		'https://github.com/acme/web/issues/1?tab=1',
	])('rejects %s', (input) => {
		expect(parseGitHubIssueInput(input).ok).toBe(false)
	})

	test('exposes the input schema for direct validation', () => {
		expect(GitHubIssueInputSchema.safeParse('https://github.com/acme/web/issues/482').data).toEqual({
			issueNumber: 482,
			repositoryFullName: 'acme/web',
		})
	})
})
