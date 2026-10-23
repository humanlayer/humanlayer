import { describe, expect, test } from 'vitest'

import {
	classifyGhOutcome,
	classifyGithubResponse,
	classifyGithubRest,
	isGhAuthFailureMessage,
	isGhRateLimitMessage,
} from './classify'

describe('isGhAuthFailureMessage', () => {
	test('matches hard GitHub auth-failure markers, case-insensitively', () => {
		expect(isGhAuthFailureMessage('gh: HTTP 401: Bad credentials')).toBe(true)
		expect(isGhAuthFailureMessage('Requires authentication (HTTP 401)')).toBe(true)
		expect(isGhAuthFailureMessage('requires authentication')).toBe(true)
	})

	test('matches gh’s local no-credentials failure (never authenticated at all)', () => {
		// gh with no stored credentials fails locally without ever reaching GitHub —
		// just as hard/non-transient as a 401, so it must latch (and self-heal via
		// the periodic latch reset once the operator runs `gh auth login`).
		expect(isGhAuthFailureMessage('To get started with GitHub CLI, please run:  gh auth login')).toBe(true)
	})

	test('does NOT match rate-limit markers (authenticated callers hit them too)', () => {
		// Latching on rate limits would disable PR tracking for the whole daemon
		// lifetime over a transient throttle — they must stay transient errors.
		expect(isGhAuthFailureMessage('API rate limit exceeded for 1.2.3.4')).toBe(false)
		expect(isGhAuthFailureMessage('API rate limit exceeded for user ID 12345')).toBe(false)
	})

	test('does not match ordinary gh errors', () => {
		expect(isGhAuthFailureMessage('no pull requests found for branch "feature"')).toBe(false)
		expect(isGhAuthFailureMessage('could not resolve to a Repository')).toBe(false)
		expect(isGhAuthFailureMessage('')).toBe(false)
	})
})

describe('isGhRateLimitMessage', () => {
	test('matches GitHub rate-limit markers, case-insensitively', () => {
		expect(isGhRateLimitMessage('API rate limit exceeded for user ID 12345')).toBe(true)
		expect(isGhRateLimitMessage('You have exceeded a secondary rate limit')).toBe(true)
	})

	test('does not match auth failures or ordinary errors', () => {
		expect(isGhRateLimitMessage('gh: HTTP 401: Bad credentials')).toBe(false)
		expect(isGhRateLimitMessage('no pull requests found')).toBe(false)
	})
})

// The classifiers are pure verdict functions; the GithubAccess service applies the
// `unauthenticated` verdict to its per-backend latch (covered by the service test).

describe('classifyGhOutcome (gh verdict mapping)', () => {
	test('exit-0 valid JSON maps to ok', () => {
		expect(classifyGhOutcome<{ number: number }>({ stdout: '{"number":42}' })).toEqual({
			kind: 'ok',
			data: { number: 42 },
		})
	})

	test('exit-0 body with a hard-auth message maps to unauthenticated', () => {
		expect(classifyGhOutcome({ stdout: '{"message":"Requires authentication (HTTP 401)"}' })).toEqual({
			kind: 'unauthenticated',
		})
	})

	test('exit-0 body with a rate-limit message maps to a transient error', () => {
		expect(classifyGhOutcome({ stdout: '{"message":"API rate limit exceeded for user ID 12345"}' })).toEqual({
			kind: 'error',
		})
	})

	test('exit-0 unparseable stdout maps to error', () => {
		expect(classifyGhOutcome({ stdout: 'not json at all' })).toEqual({ kind: 'error' })
	})

	test('execError with an auth stderr maps to unauthenticated', () => {
		expect(classifyGhOutcome({ execError: { stderr: 'gh: HTTP 401: Requires authentication', code: 1 } })).toEqual({
			kind: 'unauthenticated',
		})
	})

	test('execError from "no pull requests found" maps to a transient error', () => {
		expect(
			classifyGhOutcome({ execError: { stderr: 'no pull requests found for branch "feature"', code: 1 } }),
		).toEqual({ kind: 'error' })
	})

	test('detects a hard-auth marker on the error message field too', () => {
		expect(classifyGhOutcome({ execError: new Error('gh: Requires authentication') })).toEqual({
			kind: 'unauthenticated',
		})
	})

	test('rate-limit execError maps to a transient error', () => {
		expect(
			classifyGhOutcome({
				execError: { stderr: 'gh: API rate limit exceeded for user ID 12345 (HTTP 403)', code: 1 },
			}),
		).toEqual({ kind: 'error' })
	})
})

describe('classifyGithubResponse (GraphQL verdict mapping)', () => {
	test('2xx with a valid GraphQL data payload maps to ok', () => {
		expect(
			classifyGithubResponse<{ viewer: { login: string } }>({
				status: 200,
				body: '{"data":{"viewer":{"login":"octocat"}}}',
			}),
		).toEqual({ kind: 'ok', data: { viewer: { login: 'octocat' } } })
	})

	test('HTTP 401 maps to unauthenticated', () => {
		expect(classifyGithubResponse({ status: 401, body: '{"message":"Bad credentials"}' })).toEqual({
			kind: 'unauthenticated',
		})
	})

	test('a 200 body carrying a Bad-credentials GraphQL error maps to unauthenticated', () => {
		expect(
			classifyGithubResponse({
				status: 200,
				body: '{"errors":[{"type":"UNAUTHORIZED","message":"Bad credentials"}]}',
			}),
		).toEqual({ kind: 'unauthenticated' })
	})

	test('HTTP 403 / 429 rate limits map to a transient error', () => {
		expect(classifyGithubResponse({ status: 403, body: 'API rate limit exceeded' })).toEqual({ kind: 'error' })
		expect(classifyGithubResponse({ status: 429, body: '' })).toEqual({ kind: 'error' })
	})

	test('a 200 body with a non-auth GraphQL error (e.g. NOT_FOUND) maps to error', () => {
		expect(
			classifyGithubResponse({
				status: 200,
				body: '{"errors":[{"type":"NOT_FOUND","message":"Could not resolve to a Repository"}]}',
			}),
		).toEqual({ kind: 'error' })
	})

	test('a 200 body with null data maps to error', () => {
		expect(classifyGithubResponse({ status: 200, body: '{"data":null}' })).toEqual({ kind: 'error' })
	})

	test('unparseable 2xx body maps to error', () => {
		expect(classifyGithubResponse({ status: 200, body: '<!doctype html>' })).toEqual({ kind: 'error' })
	})

	test('other 5xx statuses map to a transient error', () => {
		expect(classifyGithubResponse({ status: 502, body: 'Bad Gateway' })).toEqual({ kind: 'error' })
	})
})

describe('classifyGithubRest (REST verdict mapping)', () => {
	test('2xx returns the parsed resource verbatim', () => {
		expect(
			classifyGithubRest<{ login: string; id: number }>({
				status: 200,
				body: '{"login":"octocat","id":583231}',
			}),
		).toEqual({ kind: 'ok', data: { login: 'octocat', id: 583231 } })
	})

	test('HTTP 401 maps to unauthenticated', () => {
		expect(classifyGithubRest({ status: 401, body: '{"message":"Bad credentials"}' })).toEqual({
			kind: 'unauthenticated',
		})
	})

	test('403 / 429 map to a transient error', () => {
		expect(classifyGithubRest({ status: 403, body: '{"message":"rate limited"}' })).toEqual({ kind: 'error' })
		expect(classifyGithubRest({ status: 429, body: '' })).toEqual({ kind: 'error' })
	})

	test('unparseable 2xx body maps to error', () => {
		expect(classifyGithubRest({ status: 200, body: 'not json' })).toEqual({ kind: 'error' })
	})
})
