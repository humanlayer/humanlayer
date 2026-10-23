import { describe, expect, test } from 'vitest'

import {
	attributePullRequest,
	BRANCH_ATTRIBUTION_WINDOW_MS,
	PULL_REQUEST_ATTRIBUTION_METHODS,
	PULL_REQUEST_ATTRIBUTION_TIERS,
	PULL_REQUEST_COUNTED_TIERS,
	pullRequestTierRank,
} from './attribute-pull-request'
import type { BranchSessionEvidence } from './evidence/method'

const NOW = 1_800_000_000_000
const SESSION_A = '018f9c2e-7a3b-7c1d-9e2f-3a4b5c6d7e8f'
const SESSION_B = '019b049c-950d-7baa-b9a8-b9364599319b'
const SESSION_C = '019b049c-950d-7baa-b9a8-b9364599319c'

function session(overrides: Partial<BranchSessionEvidence> & { sessionId: string }): BranchSessionEvidence {
	return { committedOnBranch: false, lastSeenAt: NOW, ...overrides }
}

describe('PULL_REQUEST_ATTRIBUTION_METHODS registry', () => {
	test('the registry IS the chain: tier per method, every method enabled', () => {
		expect(PULL_REQUEST_ATTRIBUTION_METHODS.map((entry) => [entry.method.name, entry.tier])).toEqual([
			['commit-ledger', 'committed'],
		])
		expect(PULL_REQUEST_ATTRIBUTION_METHODS.every((entry) => entry.enabled)).toBe(true)
	})

	test('tiers rank weakest to strongest, with null below every tier, and only committed counts', () => {
		expect(PULL_REQUEST_ATTRIBUTION_TIERS).toEqual(['observed', 'committed'])
		expect(pullRequestTierRank(null)).toBeLessThan(pullRequestTierRank('observed'))
		expect(pullRequestTierRank('observed')).toBeLessThan(pullRequestTierRank('committed'))
		expect(PULL_REQUEST_COUNTED_TIERS).toEqual(['committed'])
	})
})

describe('attributePullRequest', () => {
	test('each session books at the tier of the first method that claims it, else observed', () => {
		const result = attributePullRequest({
			now: NOW,
			sessions: [
				session({ sessionId: SESSION_A }),
				session({ sessionId: SESSION_B, committedOnBranch: true }),
				session({ sessionId: SESSION_C }),
			],
		})
		expect(result.sessions).toEqual([
			{ sessionId: SESSION_A, tier: 'observed' },
			{ sessionId: SESSION_B, tier: 'committed' },
			{ sessionId: SESSION_C, tier: 'observed' },
		])
		expect(result.strongest).toEqual({ sessionId: SESSION_B, tier: 'committed' })
	})

	test('a session last seen outside the window is dropped, and an empty window has no strongest', () => {
		const stale = NOW - BRANCH_ATTRIBUTION_WINDOW_MS - 1
		const fresh = NOW - BRANCH_ATTRIBUTION_WINDOW_MS
		expect(
			attributePullRequest({
				now: NOW,
				sessions: [
					session({ sessionId: SESSION_A, committedOnBranch: true, lastSeenAt: stale }),
					session({ sessionId: SESSION_B, lastSeenAt: fresh }),
				],
			}),
		).toEqual({
			sessions: [{ sessionId: SESSION_B, tier: 'observed' }],
			strongest: { sessionId: SESSION_B, tier: 'observed' },
		})
		expect(attributePullRequest({ now: NOW, sessions: [] })).toEqual({ sessions: [], strongest: null })
	})

	test('the strongest keeps the first session on a tie, so the pull request owner is stable', () => {
		const result = attributePullRequest({
			now: NOW,
			sessions: [
				session({ sessionId: SESSION_B, committedOnBranch: true }),
				session({ sessionId: SESSION_A, committedOnBranch: true }),
			],
		})
		expect(result.strongest).toEqual({ sessionId: SESSION_B, tier: 'committed' })
	})

	test('disabling a method for one call removes exactly its claims', () => {
		const sessions = [session({ sessionId: SESSION_A, committedOnBranch: true })]
		expect(attributePullRequest({ now: NOW, sessions }, { disabledMethods: ['commit-ledger'] }).sessions).toEqual([
			{ sessionId: SESSION_A, tier: 'observed' },
		])
	})
})
