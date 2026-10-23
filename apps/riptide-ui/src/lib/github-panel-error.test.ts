import { ORPCError } from '@orpc/client'
import { describe, expect, test } from 'vitest'

import {
	describeGitHubMutationError,
	GITHUB_CHECKS_PERMISSION_REQUIRED,
	GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED,
	GITHUB_REPOSITORY_ACCESS_BLOCKED,
	isGitHubChecksPermissionError,
} from './github-panel-error'

describe('describeGitHubMutationError', () => {
	test('shows GitHub’s own sentence for a rejected write', () => {
		expect(
			describeGitHubMutationError(
				new ORPCError('BAD_REQUEST', { defined: true, data: { message: 'Pull Request is not mergeable' } }),
			),
		).toBe('Pull Request is not mergeable')
	})

	test('explains the missing write grant instead of printing its marker', () => {
		expect(
			describeGitHubMutationError(
				new ORPCError('BAD_REQUEST', {
					defined: true,
					data: { message: GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED },
				}),
			),
		).toBe('The GitHub App needs write access to pull requests. An admin can reinstall the GitHub app in settings.')
	})

	test('explains the missing Checks grant instead of printing its marker', () => {
		expect(
			describeGitHubMutationError(
				new ORPCError('BAD_REQUEST', { defined: true, data: { message: GITHUB_CHECKS_PERMISSION_REQUIRED } }),
			),
		).toMatch(/Checks permission/)
	})

	test('explains a repository the organization blocks instead of printing its marker', () => {
		expect(
			describeGitHubMutationError(
				new ORPCError('BAD_REQUEST', {
					defined: true,
					data: { message: GITHUB_REPOSITORY_ACCESS_BLOCKED },
				}),
			),
		).toMatch(/IP allow list or SAML/)
	})

	test('falls back to a reachability message for anything else', () => {
		expect(describeGitHubMutationError(new ORPCError('SERVICE_UNAVAILABLE', { defined: true }))).toMatch(
			/could not be reached/,
		)
		expect(describeGitHubMutationError(new Error('boom'))).toMatch(/could not be reached/)
	})
})

describe('isGitHubChecksPermissionError', () => {
	test('recognises the missing Checks grant', () => {
		const error = new ORPCError('BAD_REQUEST', {
			defined: true,
			data: { message: GITHUB_CHECKS_PERMISSION_REQUIRED },
		})
		expect(isGitHubChecksPermissionError(error)).toBe(true)
	})

	test.each([
		[
			'no installation or remote',
			new ORPCError('NOT_FOUND', { defined: true, data: { message: 'no_github_remote' } }),
		],
		['GitHub or the streams tier down', new ORPCError('SERVICE_UNAVAILABLE', { defined: true })],
		['another bad request', new ORPCError('BAD_REQUEST', { defined: true, data: { message: 'something_else' } })],
		[
			'an undefined error with the same message',
			new ORPCError('BAD_REQUEST', { data: { message: GITHUB_CHECKS_PERMISSION_REQUIRED } }),
		],
		['a plain error', new Error(GITHUB_CHECKS_PERMISSION_REQUIRED)],
		['nothing', undefined],
	])('leaves %s to the hidden tab', (_label, error) => {
		expect(isGitHubChecksPermissionError(error)).toBe(false)
	})
})
