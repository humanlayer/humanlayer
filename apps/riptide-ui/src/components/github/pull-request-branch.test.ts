import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { describe, expect, test } from 'vitest'

import type { PrStatusStreamResult, PrStatusStreamStatus } from '@/hooks/session-detail/usePrStatusStream'

import { earlierPullRequestsOf, withRecordedPullRequest } from './pull-request-branch'

const recordedRow: NonNullable<PullRequestBranch['pullRequest']> = {
	id: 'humanlayer/syncopate:feat-x',
	number: 2492,
	title: 'Effect migration',
	url: 'https://github.com/humanlayer/syncopate/pull/2492',
	state: 'open',
	isDraft: false,
	headRef: 'feat-x',
	baseRef: 'main',
	headSha: 'a1b2c3d4',
	mergeable: true,
	reviewDecision: null,
}

const listed = (pullRequest: PullRequestBranch['pullRequest']): PullRequestBranch => ({
	repoFullName: 'humanlayer/syncopate',
	branch: 'feat-x',
	isCurrent: true,
	installed: true,
	sessionIds: ['s1'],
	pullRequest,
})

const streamed = (
	status: PrStatusStreamStatus,
	overrides: Partial<PrStatusStreamResult> = {},
): PrStatusStreamResult => ({
	available: status === 'ready',
	status,
	pullRequest: null,
	hasPullRequest: false,
	checks: [],
	failingCheckCount: 0,
	repoFullName: null,
	branch: null,
	staleSince: null,
	...overrides,
})

describe('withRecordedPullRequest', () => {
	test('names the branch the tab listed even when the stream never answered', () => {
		const result = withRecordedPullRequest(streamed('unavailable'), listed(null))

		expect(result.repoFullName).toBe('humanlayer/syncopate')
		expect(result.branch).toBe('feat-x')
		expect(result.available).toBe(false)
	})

	test('calls a stream that gave up recorded, so the panel can say so', () => {
		const result = withRecordedPullRequest(streamed('unavailable'), listed(recordedRow))

		expect(result.status).toBe('recorded')
		expect(result.available).toBe(true)
		expect(result.pullRequest).toEqual(recordedRow)
	})

	test('a stream still reading shows the record without calling itself recorded', () => {
		const result = withRecordedPullRequest(streamed('hydrating'), listed(recordedRow))

		expect(result.status).toBe('hydrating')
		expect(result.pullRequest).toEqual(recordedRow)
	})

	test('a ready stream that reports no pull request wins over the record', () => {
		const result = withRecordedPullRequest(
			streamed('ready', { available: true, hasPullRequest: false }),
			listed(recordedRow),
		)

		expect(result.pullRequest).toBeNull()
		expect(result.status).toBe('ready')
	})

	test('the consent prompt is never overwritten by a record', () => {
		const result = withRecordedPullRequest(streamed('permission_required'), listed(recordedRow))

		expect(result.status).toBe('permission_required')
		expect(result.pullRequest).toBeNull()
	})
})

describe('earlierPullRequestsOf', () => {
	const row = (number: number, state: 'open' | 'closed' | 'merged') => ({ ...recordedRow, number, state })
	const withEarlier = (
		pullRequest: PullRequestBranch['pullRequest'],
		earlierPullRequests?: NonNullable<PullRequestBranch['pullRequest']>[],
	): PullRequestBranch => ({ ...listed(pullRequest), earlierPullRequests })
	const numbers = (pullRequests: { number: number }[]) => pullRequests.map((pullRequest) => pullRequest.number)

	test('lists the recorded ones below the one shown, highest number first', () => {
		const branch = withEarlier(row(2512, 'open'), [row(2301, 'closed'), row(2489, 'merged')])

		expect(numbers(earlierPullRequestsOf(branch, { number: 2512 }))).toEqual([2489, 2301])
	})

	test('keeps the listed merged one when the stream already shows the next pull request', () => {
		expect(numbers(earlierPullRequestsOf(withEarlier(row(2489, 'merged'), []), { number: 2512 }))).toEqual([2489])
	})

	test('never lists an open pull request as earlier while the stream still shows the merged one', () => {
		const branch = withEarlier(row(2512, 'open'), [row(2489, 'merged')])

		expect(numbers(earlierPullRequestsOf(branch, { number: 2489 }))).toEqual([])
	})

	test('does not list the listed one when the stream says the branch has none', () => {
		expect(numbers(earlierPullRequestsOf(withEarlier(row(2489, 'merged'), [row(2301, 'closed')]), null))).toEqual([
			2301,
		])
	})

	test('lists nothing for a listing from an API without the field', () => {
		expect(earlierPullRequestsOf(withEarlier(row(2489, 'merged')), { number: 2489 })).toEqual([])
	})
})
