import type { CheckRowType, PullRequestMergeStateType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import { describe, expect, test } from 'vitest'

import {
	allowedMergeMethods,
	armedSentence,
	confirmLabel,
	confirmNote,
	deriveLifecycleLinks,
	deriveMergeRow,
	resolveMergeMethod,
} from './merge-row'

const merge = (overrides: Partial<PullRequestMergeStateType> = {}): PullRequestMergeStateType => ({
	mergeStateStatus: 'CLEAN',
	autoMergeRequest: null,
	viewerCanEnableAutoMerge: false,
	viewerCanDisableAutoMerge: false,
	viewerCanUpdateBranch: false,
	mergeHeadline: 'Merge pull request #2489',
	mergeBody: 'Add the tray',
	squashHeadline: 'Add the tray (#2489)',
	squashBody: '* one\n\n* two\n\n* three',
	commitCount: 3,
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: true,
	viewerDefaultMergeMethod: 'MERGE',
	...overrides,
})

const pullRequest = (overrides: Partial<PullRequestRowType> = {}): PullRequestRowType => ({
	id: 'humanlayer/syncopate:tray',
	number: 2489,
	title: 'Add the tray',
	url: 'https://github.com/humanlayer/syncopate/pull/2489',
	state: 'open',
	isDraft: false,
	headRef: 'tray',
	baseRef: 'main',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	mergeable: true,
	reviewDecision: 'APPROVED',
	merge: null,
	...overrides,
})

const check = (overrides: Partial<CheckRowType> = {}): CheckRowType => ({
	id: 'check_run:typecheck',
	name: 'typecheck',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: null,
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

const derive = (input: {
	pullRequest?: Partial<PullRequestRowType>
	merge?: Partial<PullRequestMergeStateType>
	checks?: CheckRowType[]
	method?: 'MERGE' | 'SQUASH' | 'REBASE'
}) =>
	deriveMergeRow({
		pullRequest: pullRequest(input.pullRequest),
		merge: merge(input.merge),
		checks: input.checks ?? [check()],
		method: input.method ?? 'SQUASH',
	})

describe('deriveMergeRow', () => {
	test('is green only when GitHub would merge and every section passed', () => {
		expect(derive({})).toMatchObject({
			kind: 'button',
			intent: 'merge',
			label: 'Squash and merge',
			primary: true,
			enabled: true,
			reason: null,
		})
	})

	test.each([
		['a failing check', { checks: [check({ conclusion: 'FAILURE' })] }],
		['a running check', { checks: [check({ status: 'IN_PROGRESS', conclusion: null })] }],
		['a review still required', { pullRequest: { reviewDecision: 'REVIEW_REQUIRED' as const } }],
		['changes requested', { pullRequest: { reviewDecision: 'CHANGES_REQUESTED' as const } }],
	])('stays grey but enabled while GitHub allows the merge with %s unsettled', (_label, input) => {
		expect(derive({ ...input, merge: { mergeStateStatus: 'UNSTABLE' } })).toMatchObject({
			kind: 'button',
			primary: false,
			enabled: true,
			reason: null,
		})
	})

	test.each([
		['BLOCKED', 'Merging is blocked due to failing merge requirements.'],
		['BEHIND', 'This branch is out-of-date with the base branch.'],
		['DIRTY', 'This branch has conflicts that must be resolved.'],
		['UNKNOWN', 'Checking for the ability to merge automatically…'],
	] as const)('is disabled with GitHub’s sentence when the state is %s', (mergeStateStatus, reason) => {
		expect(derive({ merge: { mergeStateStatus } })).toMatchObject({
			kind: 'button',
			label: 'Squash and merge',
			primary: false,
			enabled: false,
			reason,
		})
	})

	test('offers auto-merge instead when the App may arm it and the merge is blocked', () => {
		expect(derive({ merge: { mergeStateStatus: 'BLOCKED', viewerCanEnableAutoMerge: true } })).toMatchObject({
			kind: 'button',
			intent: 'enable_auto_merge',
			label: 'Enable auto-merge (squash)',
			primary: false,
			enabled: true,
			reason: 'Merging is blocked due to failing merge requirements.',
		})
	})

	test('does not offer auto-merge when the merge can happen now', () => {
		expect(derive({ merge: { viewerCanEnableAutoMerge: true } })).toMatchObject({
			intent: 'merge',
			label: 'Squash and merge',
		})
	})

	test('names the update when GitHub lets the App bring the branch up to date', () => {
		expect(derive({ merge: { mergeStateStatus: 'BEHIND', viewerCanUpdateBranch: true } })).toMatchObject({
			kind: 'button',
			enabled: false,
			canUpdateBranch: true,
		})
	})

	test('labels the button with the chosen method', () => {
		expect(derive({ method: 'MERGE' })).toMatchObject({ label: 'Merge pull request' })
		expect(derive({ method: 'REBASE' })).toMatchObject({ label: 'Rebase and merge' })
	})

	test('shows the armed sentence, with who armed it, once auto-merge is on', () => {
		expect(
			derive({
				merge: {
					mergeStateStatus: 'BLOCKED',
					autoMergeRequest: { enabledBy: { login: 'pepijn' }, mergeMethod: 'REBASE' },
					viewerCanDisableAutoMerge: true,
				},
			}),
		).toEqual({ kind: 'armed', method: 'REBASE', enabledByLogin: 'pepijn', canDisable: true })
		expect(armedSentence('REBASE')).toBe('Will rebase automatically when all requirements are met.')
	})

	test('replaces the button with the draft row for a draft', () => {
		expect(derive({ pullRequest: { isDraft: true } })).toEqual({
			kind: 'draft',
			reason: 'Draft pull requests cannot be merged.',
		})
	})

	test.each(['merged', 'closed'] as const)('hides the button once the pull request is %s', (state) => {
		expect(derive({ pullRequest: { state } })).toEqual({ kind: 'hidden' })
	})
})

describe('deriveLifecycleLinks', () => {
	test('offers draft and close on an open pull request, close alone on a draft, reopen on a closed one', () => {
		expect(deriveLifecycleLinks(pullRequest())).toEqual({ convertToDraft: true, close: true, reopen: false })
		expect(deriveLifecycleLinks(pullRequest({ isDraft: true }))).toEqual({
			convertToDraft: false,
			close: true,
			reopen: false,
		})
		expect(deriveLifecycleLinks(pullRequest({ state: 'closed' }))).toEqual({
			convertToDraft: false,
			close: false,
			reopen: true,
		})
		expect(deriveLifecycleLinks(pullRequest({ state: 'merged' }))).toEqual({
			convertToDraft: false,
			close: false,
			reopen: false,
		})
	})
})

describe('resolveMergeMethod', () => {
	test('keeps the picked method while the repository allows it, else falls back to GitHub’s default', () => {
		expect(resolveMergeMethod(merge(), 'REBASE')).toBe('REBASE')
		expect(resolveMergeMethod(merge({ rebaseMergeAllowed: false }), 'REBASE')).toBe('MERGE')
		expect(resolveMergeMethod(merge(), null)).toBe('MERGE')
		expect(resolveMergeMethod(merge({ mergeCommitAllowed: false, rebaseMergeAllowed: false }), null)).toBe('SQUASH')
	})

	test('offers the methods the repository allows, in GitHub’s order', () => {
		expect(allowedMergeMethods(merge())).toEqual(['MERGE', 'SQUASH', 'REBASE'])
		expect(allowedMergeMethods(merge({ mergeCommitAllowed: false }))).toEqual(['SQUASH', 'REBASE'])
	})
})

describe('confirm copy', () => {
	test('uses GitHub’s confirm labels', () => {
		expect(confirmLabel('merge', 'MERGE')).toBe('Confirm merge')
		expect(confirmLabel('merge', 'SQUASH')).toBe('Confirm squash and merge')
		expect(confirmLabel('enable_auto_merge', 'REBASE')).toBe('Confirm auto-merge (rebase)')
	})

	test('says what the method will do to the commits and the base', () => {
		expect(confirmNote({ intent: 'merge', method: 'SQUASH', commitCount: 3, baseRef: 'main' })).toBe(
			'This will squash 3 commits into one and merge it into main.',
		)
		expect(confirmNote({ intent: 'merge', method: 'MERGE', commitCount: 1, baseRef: 'main' })).toBe(
			'This will merge 1 commit into main with a merge commit.',
		)
		expect(confirmNote({ intent: 'enable_auto_merge', method: 'REBASE', commitCount: 2, baseRef: 'dev' })).toBe(
			'When all requirements are met, this will rebase 2 commits onto dev and merge them.',
		)
	})
})
