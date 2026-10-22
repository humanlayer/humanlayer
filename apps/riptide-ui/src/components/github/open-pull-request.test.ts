import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { describe, expect, test } from 'vitest'

import { offersOpenPullRequest, offersOpenPullRequestInPanel } from './open-pull-request'
import type { GitHubPanelState } from './panel-state'

const recorded = { number: 2489 } as PullRequestRowType
const withState = (state: PullRequestRowType['state']) => ({ number: 2489, state }) as PullRequestRowType

const offer = (state: GitHubPanelState, pullRequest: PullRequestRowType | null = null) =>
	offersOpenPullRequest(state, pullRequest !== null, pullRequest)

describe('offersOpenPullRequest', () => {
	test('offers when GitHub was asked and answered that the branch has none', () => {
		expect(offer('live')).toBe(true)
	})

	test('never offers on a branch that already has a pull request', () => {
		expect(offer('live', recorded)).toBe(false)
	})

	test('stays out of every state that has not asked GitHub', () => {
		expect(offer('loading')).toBe(false)
		expect(offer('recorded')).toBe(false)
		expect(offer('unavailable')).toBe(false)
	})

	test('does not offer on a stale record that has one', () => {
		expect(offer('recorded', recorded)).toBe(false)
	})

	test('does not trust `hasPullRequest` alone when the row has not arrived', () => {
		expect(offersOpenPullRequest('live', true, null)).toBe(false)
	})
})

describe('offersOpenPullRequestInPanel', () => {
	const offerInPanel = (state: GitHubPanelState, pullRequest: PullRequestRowType | null = null) =>
		offersOpenPullRequestInPanel(state, pullRequest !== null, pullRequest)

	test('offers on a branch with no pull request', () => {
		expect(offerInPanel('live')).toBe(true)
	})

	test('offers again once the pull request merged', () => {
		expect(offerInPanel('live', withState('merged'))).toBe(true)
	})

	test('does not offer while the pull request is open or closed', () => {
		expect(offerInPanel('live', withState('open'))).toBe(false)
		expect(offerInPanel('live', withState('closed'))).toBe(false)
	})

	test('does not offer on a merged record that has not asked GitHub', () => {
		expect(offerInPanel('recorded', withState('merged'))).toBe(false)
		expect(offerInPanel('unavailable', withState('merged'))).toBe(false)
	})
})
