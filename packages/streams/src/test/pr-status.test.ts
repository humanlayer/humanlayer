import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import {
	type CheckRowType,
	checkRowId,
	checksOnCurrentCommit,
	currentCheckHeadSha,
	mergeCheckRows,
	PullRequestRow,
	type PullRequestRowType,
	supersedesCheckRow,
} from '../pr-status'

const OLD_SHA = '1111111111111111111111111111111111111111'
const NEW_SHA = '2222222222222222222222222222222222222222'

const check = (overrides: Partial<CheckRowType> = {}): CheckRowType => ({
	id: checkRowId({ kind: 'check_run', name: 'typecheck' }),
	name: 'typecheck',
	headSha: OLD_SHA,
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: null,
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const pullRequest = (overrides: Partial<PullRequestRowType> = {}): PullRequestRowType => ({
	id: 'humanlayer/syncopate:feat/x',
	number: 1,
	title: 'A pull request',
	url: 'https://github.com/humanlayer/syncopate/pull/1',
	state: 'open',
	isDraft: false,
	headRef: 'feat/x',
	baseRef: 'main',
	headSha: OLD_SHA,
	mergeable: true,
	reviewDecision: null,
	unresolvedThreadCount: null,
	resolvedThreadCount: null,
	changesRequestedReviews: null,
	merge: null,
	...overrides,
})

describe('PullRequestRow', () => {
	it('decodes a row written before the review fields existed as not known yet', () => {
		const {
			unresolvedThreadCount: _u,
			resolvedThreadCount: _r,
			changesRequestedReviews: _c,
			...legacy
		} = pullRequest()
		expect(Schema.decodeUnknownSync(PullRequestRow)(legacy)).toMatchObject({
			unresolvedThreadCount: null,
			resolvedThreadCount: null,
			changesRequestedReviews: null,
		})
	})

	it('keeps the review fields a current writer sends', () => {
		const review = {
			login: 'reviewer',
			body: 'Split this.',
			submittedAt: '2026-09-01T10:00:00Z',
			url: 'https://github.com/humanlayer/syncopate/pull/1#pullrequestreview-1',
		}
		expect(
			Schema.decodeUnknownSync(PullRequestRow)(
				pullRequest({ unresolvedThreadCount: 2, resolvedThreadCount: 1, changesRequestedReviews: [review] }),
			),
		).toMatchObject({ unresolvedThreadCount: 2, resolvedThreadCount: 1, changesRequestedReviews: [review] })
	})

	it('decodes a row written before the merge state existed as not known yet', () => {
		const { merge: _merge, ...legacy } = pullRequest()
		expect(Schema.decodeUnknownSync(PullRequestRow)(legacy)).toMatchObject({ merge: null })
	})

	it('keeps the merge state a current writer sends', () => {
		const merge = {
			mergeStateStatus: 'CLEAN' as const,
			autoMergeRequest: { enabledBy: { login: 'pepijn' }, mergeMethod: 'SQUASH' as const },
			viewerCanEnableAutoMerge: false,
			viewerCanDisableAutoMerge: true,
			viewerCanUpdateBranch: false,
			mergeHeadline: 'Merge pull request #1',
			mergeBody: 'A pull request',
			squashHeadline: 'A pull request (#1)',
			squashBody: '* first\n\n* second',
			commitCount: 3,
			mergeCommitAllowed: true,
			squashMergeAllowed: true,
			rebaseMergeAllowed: false,
			viewerDefaultMergeMethod: 'SQUASH' as const,
		}
		expect(Schema.decodeUnknownSync(PullRequestRow)(pullRequest({ merge }))).toMatchObject({ merge })
	})
})

describe('supersedesCheckRow', () => {
	it('keeps the completed report when the queued one is applied after it', () => {
		const completed = check({ status: 'COMPLETED', conclusion: 'FAILURE' })
		const queued = check({ status: 'QUEUED', conclusion: null })

		expect(supersedesCheckRow(queued, completed)).toBe(false)
		expect(supersedesCheckRow(completed, queued)).toBe(true)
	})

	it('lets a later run of the same name supersede a finished earlier one', () => {
		const firstRun = check({ status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-08-30T09:00:00Z' })
		const reRun = check({
			status: 'QUEUED',
			conclusion: null,
			startedAt: '2026-08-30T10:00:00Z',
			completedAt: null,
		})

		expect(supersedesCheckRow(reRun, firstRun)).toBe(true)
		expect(supersedesCheckRow(firstRun, reRun)).toBe(false)
	})

	it('treats an unparseable or absent start as the oldest possible', () => {
		const started = check({ startedAt: '2026-08-30T09:00:00Z' })
		const unstarted = check({ startedAt: null, status: 'QUEUED', conclusion: null })

		expect(supersedesCheckRow(unstarted, started)).toBe(false)
	})

	it('keeps what it holds on a tie, so re-applying a row never reorders the list', () => {
		const row = check()
		expect(supersedesCheckRow({ ...row }, row)).toBe(false)
	})
})

describe('mergeCheckRows', () => {
	it('folds a stale re-delivery without moving the check backwards', () => {
		const completed = check({ status: 'COMPLETED', conclusion: 'FAILURE' })
		const queued = check({ status: 'QUEUED', conclusion: null })

		const held = mergeCheckRows(new Map(), [completed])
		const afterStaleDelivery = mergeCheckRows(held, [queued])

		expect(afterStaleDelivery.get(completed.id)?.status).toBe('COMPLETED')
		expect(afterStaleDelivery.get(completed.id)?.conclusion).toBe('FAILURE')
	})

	it('does not mutate the map it was given', () => {
		const held = mergeCheckRows(new Map(), [check()])
		const size = held.size
		mergeCheckRows(held, [check({ id: 'check_run:quality', name: 'quality' })])
		expect(held.size).toBe(size)
	})
})

describe('checksOnCurrentCommit', () => {
	it('drops a job the current commit no longer has', () => {
		const renamedAway = check({
			id: 'check_run:test (18)',
			name: 'test (18)',
			headSha: OLD_SHA,
			conclusion: 'FAILURE',
			startedAt: '2026-08-30T09:00:00Z',
		})
		const current = check({
			id: 'check_run:test (20)',
			name: 'test (20)',
			headSha: NEW_SHA,
			startedAt: '2026-08-30T10:00:00Z',
		})

		const visible = checksOnCurrentCommit({
			pullRequest: pullRequest({ headSha: OLD_SHA }),
			checks: [renamedAway, current],
		})

		expect(visible.map((entry) => entry.name)).toEqual(['test (20)'])
	})

	it('follows the newest check rather than a stale pull request row', () => {
		expect(
			currentCheckHeadSha({
				pullRequest: pullRequest({ headSha: OLD_SHA }),
				checks: [check({ headSha: NEW_SHA, startedAt: '2026-08-30T10:00:00Z' })],
			}),
		).toBe(NEW_SHA)
	})

	it('falls back to the pull request when no check names a commit', () => {
		expect(currentCheckHeadSha({ pullRequest: pullRequest({ headSha: OLD_SHA }), checks: [] })).toBe(OLD_SHA)
	})

	it('shows every check when no commit can be established', () => {
		const rows = [check({ headSha: '' }), check({ id: 'check_run:quality', name: 'quality', headSha: '' })]
		expect(checksOnCurrentCommit({ pullRequest: null, checks: rows })).toHaveLength(2)
		expect(checksOnCurrentCommit({ pullRequest: pullRequest({ headSha: '' }), checks: rows })).toHaveLength(2)
	})
})
