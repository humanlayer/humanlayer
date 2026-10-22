import type { PullRequestMutationType } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import {
	type CheckRowType,
	MERGE_METHODS,
	type MergeMethod,
	type MergeStateStatus,
	type PullRequestMergeStateType,
	type PullRequestRowType,
} from '@humanlayer/streams/pr-status'

import { groupChecks } from './check-groups'

/**
 * GitHub's merge button, as a pure function of the row. The label, the colour and whether the
 * button is enabled follow the rules GitHub's own merge box applies, so the button here reads
 * exactly like the one on the pull request page.
 */

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
	MERGE: 'Merge pull request',
	SQUASH: 'Squash and merge',
	REBASE: 'Rebase and merge',
}

export const MERGE_METHOD_SHORT_LABELS: Record<MergeMethod, string> = {
	MERGE: 'merge commit',
	SQUASH: 'squash',
	REBASE: 'rebase',
}

const MERGE_METHOD_VERBS: Record<MergeMethod, string> = {
	MERGE: 'merge',
	SQUASH: 'squash',
	REBASE: 'rebase',
}

const CONFIRM_LABELS: Record<MergeMethod, string> = {
	MERGE: 'Confirm merge',
	SQUASH: 'Confirm squash and merge',
	REBASE: 'Confirm rebase and merge',
}

export const BUSY_LABELS: Record<PullRequestMutationType, string> = {
	merge: 'Merging…',
	enable_auto_merge: 'Enabling auto-merge…',
	disable_auto_merge: 'Disabling auto-merge…',
	update_branch: 'Updating branch…',
	ready_for_review: 'Marking ready…',
	convert_to_draft: 'Converting to draft…',
	close: 'Closing…',
	reopen: 'Reopening…',
}

/** GitHub's sentence for each merge state that stops the merge. */
const BLOCKED_REASONS: Partial<Record<MergeStateStatus, string>> = {
	BLOCKED: 'Merging is blocked due to failing merge requirements.',
	BEHIND: 'This branch is out-of-date with the base branch.',
	DIRTY: 'This branch has conflicts that must be resolved.',
	UNKNOWN: 'Checking for the ability to merge automatically…',
	DRAFT: 'Draft pull requests cannot be merged.',
}

/** GitHub's wording for a state it will not merge and does not explain. */
const UNMERGEABLE_REASON = 'This pull request cannot be merged.'

const DRAFT_REASON = 'Draft pull requests cannot be merged.'

/** GitHub lets the button merge in these states; `UNSTABLE` is a failing check nobody required. */
const MERGEABLE_STATES: ReadonlySet<MergeStateStatus> = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS'])

export type MergeIntent = 'merge' | 'enable_auto_merge'

export type MergeRowView =
	/** Merged, or closed: nothing to press but the lifecycle links. */
	| { readonly kind: 'hidden' }
	| { readonly kind: 'draft'; readonly reason: string }
	| {
			readonly kind: 'armed'
			readonly method: MergeMethod
			readonly enabledByLogin: string | null
			readonly canDisable: boolean
	  }
	| {
			readonly kind: 'button'
			readonly intent: MergeIntent
			readonly label: string
			/** Green: GitHub would merge and every section passed. Grey otherwise. */
			readonly primary: boolean
			readonly enabled: boolean
			/** GitHub's sentence for why the merge itself cannot happen right now, or null. */
			readonly reason: string | null
			readonly canUpdateBranch: boolean
	  }

export interface LifecycleLinks {
	readonly convertToDraft: boolean
	readonly close: boolean
	readonly reopen: boolean
}

export const isMergeable = (merge: PullRequestMergeStateType): boolean => MERGEABLE_STATES.has(merge.mergeStateStatus)

/**
 * Every section of the merge box passed: no failing or running check, no review standing in the
 * way, no conflict. This is what turns the button green; a merge GitHub allows with a section
 * unsettled stays grey.
 */
export const allSectionsPassed = (pullRequest: PullRequestRowType, checks: readonly CheckRowType[]): boolean => {
	const groups = groupChecks(checks)
	if (groups.failed.length > 0 || groups.running.length > 0) return false
	if (pullRequest.reviewDecision === 'CHANGES_REQUESTED' || pullRequest.reviewDecision === 'REVIEW_REQUIRED') {
		return false
	}
	return pullRequest.mergeable !== false
}

const METHOD_ALLOWED_BY: Record<MergeMethod, keyof PullRequestMergeStateType> = {
	MERGE: 'mergeCommitAllowed',
	SQUASH: 'squashMergeAllowed',
	REBASE: 'rebaseMergeAllowed',
}

/** The methods the repository offers, in GitHub's order. */
export const allowedMergeMethods = (merge: PullRequestMergeStateType): readonly MergeMethod[] =>
	MERGE_METHODS.filter((method) => merge[METHOD_ALLOWED_BY[method]] === true)

/** The picked method when the repository still allows it, else the repository's default. */
export const resolveMergeMethod = (merge: PullRequestMergeStateType, picked: MergeMethod | null): MergeMethod => {
	const allowed = allowedMergeMethods(merge)
	if (picked && allowed.includes(picked)) return picked
	if (allowed.includes(merge.viewerDefaultMergeMethod)) return merge.viewerDefaultMergeMethod
	return allowed[0] ?? merge.viewerDefaultMergeMethod
}

export const deriveMergeRow = (input: {
	readonly pullRequest: PullRequestRowType
	readonly merge: PullRequestMergeStateType
	readonly checks: readonly CheckRowType[]
	readonly method: MergeMethod
}): MergeRowView => {
	const { pullRequest, merge, method } = input
	if (pullRequest.state !== 'open') return { kind: 'hidden' }
	if (pullRequest.isDraft) return { kind: 'draft', reason: DRAFT_REASON }
	if (merge.autoMergeRequest) {
		return {
			kind: 'armed',
			method: merge.autoMergeRequest.mergeMethod,
			enabledByLogin: merge.autoMergeRequest.enabledBy?.login ?? null,
			canDisable: merge.viewerCanDisableAutoMerge,
		}
	}
	const mergeable = isMergeable(merge)
	const autoMergeAvailable = merge.viewerCanEnableAutoMerge && !mergeable
	return {
		kind: 'button',
		intent: autoMergeAvailable ? 'enable_auto_merge' : 'merge',
		label: autoMergeAvailable
			? `Enable auto-merge (${MERGE_METHOD_SHORT_LABELS[method]})`
			: MERGE_METHOD_LABELS[method],
		primary: mergeable && allSectionsPassed(pullRequest, input.checks),
		enabled: mergeable || autoMergeAvailable,
		reason: mergeable ? null : (BLOCKED_REASONS[merge.mergeStateStatus] ?? UNMERGEABLE_REASON),
		canUpdateBranch: merge.viewerCanUpdateBranch,
	}
}

export const deriveLifecycleLinks = (pullRequest: PullRequestRowType): LifecycleLinks => ({
	convertToDraft: pullRequest.state === 'open' && !pullRequest.isDraft,
	close: pullRequest.state === 'open',
	reopen: pullRequest.state === 'closed',
})

export const confirmLabel = (intent: MergeIntent, method: MergeMethod): string =>
	intent === 'merge' ? CONFIRM_LABELS[method] : `Confirm auto-merge (${MERGE_METHOD_SHORT_LABELS[method]})`

export const armedSentence = (method: MergeMethod): string =>
	`Will ${MERGE_METHOD_VERBS[method]} automatically when all requirements are met.`

const commitsPhrase = (count: number): string => (count === 1 ? '1 commit' : `${count} commits`)

/** What pressing confirm does, in one sentence, for the method picked. */
export const confirmNote = (input: {
	readonly intent: MergeIntent
	readonly method: MergeMethod
	readonly commitCount: number
	readonly baseRef: string
}): string => {
	const commits = commitsPhrase(input.commitCount)
	const outcome = {
		MERGE: `merge ${commits} into ${input.baseRef} with a merge commit`,
		SQUASH: `squash ${commits} into one and merge it into ${input.baseRef}`,
		REBASE: `rebase ${commits} onto ${input.baseRef} and merge them`,
	}[input.method]
	return input.intent === 'merge' ? `This will ${outcome}.` : `When all requirements are met, this will ${outcome}.`
}

/** A rebase writes no commit of its own, so it has no message to edit. */
export const methodWritesCommit = (method: MergeMethod): method is 'MERGE' | 'SQUASH' => method !== 'REBASE'

/** The message GitHub would write for a method that writes one. */
export const prefilledCommitMessage = (
	merge: PullRequestMergeStateType,
	method: 'MERGE' | 'SQUASH',
): { readonly headline: string; readonly body: string } =>
	method === 'MERGE'
		? { headline: merge.mergeHeadline, body: merge.mergeBody }
		: { headline: merge.squashHeadline, body: merge.squashBody }
