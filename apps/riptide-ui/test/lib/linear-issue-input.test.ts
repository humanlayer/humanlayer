import { describe, expect, test } from 'vitest'

import { parseLinearIssueInput } from '@/lib/linear-issue-input'

describe('parseLinearIssueInput', () => {
	test.each([
		['ENG-123', 'ENG-123'],
		['eng-123', 'eng-123'],
		['TEAM-1-123', 'TEAM-1-123'],
		[' team-2-alpha-456 ', 'team-2-alpha-456'],
	])('accepts Linear issue identifier %s', (input, issueId) => {
		expect(parseLinearIssueInput(input)).toEqual({ ok: true, issueId, source: 'identifier' })
	})

	test.each([
		['https://linear.app/acme/issue/ENG-123/example-title', 'ENG-123'],
		['https://linear.app/acme/issue/ENG-123', 'ENG-123'],
		['https://linear.app/acme/issue/ENG-123/', 'ENG-123'],
		['https://linear.app/acme/issue/ENG-123/example-title?foo=bar#comments', 'ENG-123'],
		['https://linear.app/acme/issue/TEAM-1-123/title-with-team-dashes', 'TEAM-1-123'],
	])('accepts Linear issue URL %s', (input, issueId) => {
		expect(parseLinearIssueInput(input)).toEqual({ ok: true, issueId, source: 'url' })
	})

	test.each([
		'',
		'ENG',
		'ENG-ABC',
		'ENG-',
		'ENG-123abc',
		'ENG-123/extra',
		'acme/issue/ENG-123/title',
		'/acme/issue/ENG-123/title',
		'https://linear.app/acme/issue',
		'https://linear.app/acme/issue/',
		'https://linear.app/acme/issue/ENG',
		'https://linear.app/acme/issue/ENG-ABC',
		'https://example.com/acme/issue/ENG-123/title',
		'https://linear.example.com/acme/issue/ENG-123/title',
		'https://linear.app/acme/not-issue/ENG-123/title',
		'https://linear.app/acme/issue/title-only',
	])('rejects malformed Linear input %s', (input) => {
		expect(parseLinearIssueInput(input)).toEqual({ ok: false, message: 'Enter a Linear issue ID or URL' })
	})
})
