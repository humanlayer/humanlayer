import { parseSessionFromTrailer } from '@humanlayer/git-attribution'
import {
	CHECK_CONCLUSIONS,
	CHECK_STATUSES,
	type ChangesRequestedReviewType,
	type CheckConclusion,
	type CheckRowType,
	checkRowId,
	type CheckStatus,
	MERGE_METHODS,
	MERGE_STATE_STATUSES,
	type PullRequestMergeStateType,
	type PullRequestRowType,
} from '@humanlayer/streams/pr-status'
import * as Schema from 'effect/Schema'

import type { GitHubCapability } from '../github.permissions'

/**
 * What GitHub's API says about a pull request: the panel's GraphQL document, the shapes its
 * response decodes into, and the mapping from those onto the rows the panel stream carries.
 * The other direction, what our own database holds, lives in `./persistence`.
 */

// GitHub bills a query as summed connection sizes ÷ 100, minimum 1, so ten nodes still cost one
// point against the installation's 5,000/hour budget.
const PANEL_PULL_REQUEST_PAGE_SIZE = 10
// GitHub's maximum page; the threads are counted, never rendered, so only `isResolved` is read.
export const REVIEW_THREAD_PAGE_SIZE = 100
// `latestReviews` is one review per reviewer, so ten covers every reviewer a pull request has.
const LATEST_REVIEW_PAGE_SIZE = 10

const reviewThreadsSelection = (after: string) => `
	reviewThreads(first: ${REVIEW_THREAD_PAGE_SIZE}${after}) {
		pageInfo {
			hasNextPage
			endCursor
		}
		nodes {
			isResolved
		}
	}`

/** How the repository lets pull requests merge; the same for every pull request in it. */
const repositoryMergeSettingsSelection = `
			mergeCommitAllowed
			squashMergeAllowed
			rebaseMergeAllowed
			viewerDefaultMergeMethod`

// The commit message GitHub would write is asked per method because the App, as the viewer,
// sees exactly what the merge will produce; a rebase writes no commit of its own.
const mergeStateSelection = `
					mergeStateStatus
					autoMergeRequest {
						enabledBy {
							login
						}
						mergeMethod
					}
					viewerCanEnableAutoMerge
					viewerCanDisableAutoMerge
					viewerCanUpdateBranch
					mergeHeadline: viewerMergeHeadlineText(mergeType: MERGE)
					mergeBody: viewerMergeBodyText(mergeType: MERGE)
					squashHeadline: viewerMergeHeadlineText(mergeType: SQUASH)
					squashBody: viewerMergeBodyText(mergeType: SQUASH)`

/**
 * The grants the panel document reads, declared beside the document itself so a selection and
 * the guard in front of it cannot drift. `statusCheckRollup.contexts` is a union of two node
 * types behind two different grants: `CheckRun` needs Checks, `StatusContext` needs Commit
 * statuses, and a repository whose CI reports through commit statuses returns only the second.
 */
export const PULL_REQUEST_PANEL_CAPABILITIES: readonly GitHubCapability[] = [
	'readPullRequests',
	'readChecks',
	'readCommitStatuses',
]

export const PULL_REQUEST_PANEL_QUERY = `
	query RiptidePullRequestPanel($owner: String!, $repo: String!, $branch: String!) {
		repository(owner: $owner, name: $repo) {
			${repositoryMergeSettingsSelection}
			pullRequests(headRefName: $branch, first: ${PANEL_PULL_REQUEST_PAGE_SIZE}, orderBy: { field: CREATED_AT, direction: DESC }) {
				nodes {
					number
					title
					url
					state
					isDraft
					mergeable
					reviewDecision
					headRefName
					baseRefName
					headRepository {
						nameWithOwner
					}
					${reviewThreadsSelection('')}
					latestReviews(first: ${LATEST_REVIEW_PAGE_SIZE}) {
						nodes {
							state
							body
							submittedAt
							url
							author {
								login
							}
						}
					}
					${mergeStateSelection}
					commits(last: 1) {
						totalCount
						nodes {
							commit {
								oid
								message
								statusCheckRollup {
									contexts(first: 100) {
										nodes {
											__typename
											... on CheckRun {
												name
												status
												conclusion
												startedAt
												completedAt
												detailsUrl
											}
											... on StatusContext {
												context
												state
												targetUrl
												createdAt
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
`

/** The pages after the first, for a pull request with more threads than one page holds. */
export const PULL_REQUEST_REVIEW_THREADS_QUERY = `
	query RiptidePullRequestReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String!) {
		repository(owner: $owner, name: $repo) {
			pullRequest(number: $number) {
				${reviewThreadsSelection(', after: $after')}
			}
		}
	}
`

export const GitHubReviewThreadsWire = Schema.Struct({
	pageInfo: Schema.Struct({
		hasNextPage: Schema.Boolean,
		endCursor: Schema.NullOr(Schema.String),
	}),
	nodes: Schema.Array(Schema.NullOr(Schema.Struct({ isResolved: Schema.Boolean }))),
})
export type GitHubReviewThreadsWire = Schema.Schema.Type<typeof GitHubReviewThreadsWire>

export const GitHubPullRequestReviewThreadsResponse = Schema.Struct({
	repository: Schema.NullOr(
		Schema.Struct({
			pullRequest: Schema.NullOr(Schema.Struct({ reviewThreads: GitHubReviewThreadsWire })),
		}),
	),
})

// https://docs.github.com/en/graphql/reference/enums#pullrequestreviewstate
export const GitHubReviewWire = Schema.Struct({
	state: Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
	body: Schema.String,
	submittedAt: Schema.NullOr(Schema.String),
	url: Schema.String,
	/** Null for a reviewer whose account is gone. */
	author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
})
export type GitHubReviewWire = Schema.Schema.Type<typeof GitHubReviewWire>

export const GitHubCheckRunWire = Schema.Struct({
	__typename: Schema.Literal('CheckRun'),
	name: Schema.String,
	status: Schema.Literals(CHECK_STATUSES),
	conclusion: Schema.NullOr(Schema.Literals(CHECK_CONCLUSIONS)),
	startedAt: Schema.NullOr(Schema.String),
	completedAt: Schema.NullOr(Schema.String),
	detailsUrl: Schema.NullOr(Schema.String),
})

export const GitHubStatusContextWire = Schema.Struct({
	__typename: Schema.Literal('StatusContext'),
	context: Schema.String,
	state: Schema.Literals(['ERROR', 'EXPECTED', 'FAILURE', 'PENDING', 'SUCCESS']),
	targetUrl: Schema.NullOr(Schema.String),
	createdAt: Schema.NullOr(Schema.String),
})

export const GitHubStatusCheckRollupContextWire = Schema.Union([GitHubCheckRunWire, GitHubStatusContextWire])
export type GitHubStatusCheckRollupContextWireType = Schema.Schema.Type<typeof GitHubStatusCheckRollupContextWire>
export type GitHubStatusContextWireType = Schema.Schema.Type<typeof GitHubStatusContextWire>

export const GitHubMergeMethodWire = Schema.Literals(MERGE_METHODS)

export const GitHubPullRequestWire = Schema.Struct({
	number: Schema.Number,
	title: Schema.String,
	url: Schema.String,
	state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
	isDraft: Schema.Boolean,
	mergeable: Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
	reviewDecision: Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])),
	headRefName: Schema.String,
	baseRefName: Schema.String,
	/** Null once the head repository is gone, which leaves no way to prove the branch is ours. */
	headRepository: Schema.NullOr(Schema.Struct({ nameWithOwner: Schema.String })),
	reviewThreads: GitHubReviewThreadsWire,
	latestReviews: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(GitHubReviewWire)) }),
	mergeStateStatus: Schema.Literals(MERGE_STATE_STATUSES),
	autoMergeRequest: Schema.NullOr(
		Schema.Struct({
			/** Null for an actor whose account is gone. */
			enabledBy: Schema.NullOr(Schema.Struct({ login: Schema.String })),
			mergeMethod: GitHubMergeMethodWire,
		}),
	),
	viewerCanEnableAutoMerge: Schema.Boolean,
	viewerCanDisableAutoMerge: Schema.Boolean,
	viewerCanUpdateBranch: Schema.Boolean,
	mergeHeadline: Schema.String,
	mergeBody: Schema.String,
	squashHeadline: Schema.String,
	squashBody: Schema.String,
	commits: Schema.Struct({
		totalCount: Schema.Int,
		nodes: Schema.Array(
			Schema.NullOr(
				Schema.Struct({
					commit: Schema.Struct({
						oid: Schema.String,
						message: Schema.String,
						statusCheckRollup: Schema.NullOr(
							Schema.Struct({
								contexts: Schema.Struct({
									nodes: Schema.Array(Schema.NullOr(GitHubStatusCheckRollupContextWire)),
								}),
							}),
						),
					}),
				}),
			),
		),
	}),
})
export interface GitHubPullRequestWire extends Schema.Schema.Type<typeof GitHubPullRequestWire> {}

export const GitHubRepositoryMergeSettingsWire = Schema.Struct({
	mergeCommitAllowed: Schema.Boolean,
	squashMergeAllowed: Schema.Boolean,
	rebaseMergeAllowed: Schema.Boolean,
	viewerDefaultMergeMethod: GitHubMergeMethodWire,
})
export type GitHubRepositoryMergeSettingsWire = Schema.Schema.Type<typeof GitHubRepositoryMergeSettingsWire>

/**
 * One pull request as fetched: the wire node, the thread pages that did not fit on it, and the
 * merge settings of the repository holding it.
 */
export interface FetchedPullRequest {
	readonly wire: GitHubPullRequestWire
	/** Empty when the first page held every thread. */
	readonly moreReviewThreads: ReadonlyArray<GitHubReviewThreadsWire>
	readonly repository: GitHubRepositoryMergeSettingsWire
}

export const GitHubPullRequestPanelResponse = Schema.Struct({
	repository: Schema.NullOr(
		Schema.Struct({
			...GitHubRepositoryMergeSettingsWire.fields,
			pullRequests: Schema.Struct({
				nodes: Schema.Array(Schema.NullOr(GitHubPullRequestWire)),
			}),
		}),
	),
})

export const decodeGitHubPullRequestPanelResponse = Schema.decodeUnknownEffect(GitHubPullRequestPanelResponse)

export const pullRequestRowId = (input: { readonly repoFullName: string; readonly branch: string }): string =>
	`${input.repoFullName.toLowerCase()}:${input.branch}`

/**
 * `headRefName` matches a fork's branch of the same name too, and the panel would then show a
 * stranger's pull request for our branch, so only a head on the repository we queried counts.
 */
export const selectPanelPullRequest = (input: {
	readonly nodes: ReadonlyArray<GitHubPullRequestWire | null>
	readonly repoFullName: string
}): GitHubPullRequestWire | null => {
	const repoFullName = input.repoFullName.toLowerCase()
	const newestFirst = input.nodes.filter(
		(node): node is GitHubPullRequestWire =>
			node !== null && node.headRepository?.nameWithOwner.toLowerCase() === repoFullName,
	)
	return newestFirst.find((node) => node.state === 'OPEN') ?? newestFirst[0] ?? null
}

const mergeableFromWire = (mergeable: GitHubPullRequestWire['mergeable']): boolean | null =>
	mergeable === 'UNKNOWN' ? null : mergeable === 'MERGEABLE'

const headShaOf = (wire: GitHubPullRequestWire): string => wire.commits.nodes[0]?.commit.oid ?? ''

/** The session the head commit's `HumanLayer-Session` trailer names, if any. */
export const headCommitSessionId = (wire: GitHubPullRequestWire): string | undefined =>
	parseSessionFromTrailer(wire.commits.nodes[0]?.commit.message)

/** GraphQL shouts its enums; every row we keep or publish uses the spelling the column stores. */
const STATE_BY_WIRE = {
	OPEN: 'open',
	CLOSED: 'closed',
	MERGED: 'merged',
} as const satisfies Record<GitHubPullRequestWire['state'], PullRequestRowType['state']>

export interface ReviewThreadCounts {
	readonly unresolved: number
	readonly resolved: number
}

export const countReviewThreads = (pages: ReadonlyArray<GitHubReviewThreadsWire>): ReviewThreadCounts => {
	let unresolved = 0
	let resolved = 0
	for (const page of pages) {
		for (const thread of page.nodes) {
			if (thread === null) continue
			if (thread.isResolved) resolved += 1
			else unresolved += 1
		}
	}
	return { unresolved, resolved }
}

const submittedAtMillis = (review: { readonly submittedAt: string | null }): number => {
	if (!review.submittedAt) return 0
	const parsed = Date.parse(review.submittedAt)
	return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The merge state is GitHub's own fields, kept under GitHub's own names. Only the check rollup is
 * left behind, because it becomes check rows, and `commits.totalCount` is lifted, because GraphQL
 * cannot return a nested field flat.
 */
export const toMergeState = (input: {
	readonly wire: GitHubPullRequestWire
	readonly repository: GitHubRepositoryMergeSettingsWire
}): PullRequestMergeStateType => ({
	mergeStateStatus: input.wire.mergeStateStatus,
	autoMergeRequest: input.wire.autoMergeRequest,
	viewerCanEnableAutoMerge: input.wire.viewerCanEnableAutoMerge,
	viewerCanDisableAutoMerge: input.wire.viewerCanDisableAutoMerge,
	viewerCanUpdateBranch: input.wire.viewerCanUpdateBranch,
	mergeHeadline: input.wire.mergeHeadline,
	mergeBody: input.wire.mergeBody,
	squashHeadline: input.wire.squashHeadline,
	squashBody: input.wire.squashBody,
	commitCount: input.wire.commits.totalCount,
	...input.repository,
})

/**
 * Every reviewer whose latest review requested changes and said why, newest first. A review with
 * no body has nothing to quote; its objection still shows through `reviewDecision`.
 */
export const toChangesRequestedReviews = (
	reviews: ReadonlyArray<GitHubReviewWire | null>,
): ChangesRequestedReviewType[] =>
	reviews
		.filter(
			(review): review is GitHubReviewWire =>
				review !== null && review.state === 'CHANGES_REQUESTED' && review.body.trim().length > 0,
		)
		.sort((a, b) => submittedAtMillis(b) - submittedAtMillis(a))
		.map((review) => ({
			login: review.author?.login ?? null,
			body: review.body,
			submittedAt: review.submittedAt,
			url: review.url,
		}))

export const toPullRequestRow = (input: {
	readonly repoFullName: string
	readonly branch: string
	readonly wire: GitHubPullRequestWire
	readonly repository: GitHubRepositoryMergeSettingsWire
	/** The thread pages after the one on the wire, when the pull request had more than one. */
	readonly moreReviewThreads?: ReadonlyArray<GitHubReviewThreadsWire>
}): PullRequestRowType => {
	const moreReviewThreads = input.moreReviewThreads ?? []
	const threads = countReviewThreads([input.wire.reviewThreads, ...moreReviewThreads])
	return {
		id: pullRequestRowId(input),
		number: input.wire.number,
		title: input.wire.title,
		url: input.wire.url,
		state: STATE_BY_WIRE[input.wire.state],
		isDraft: input.wire.isDraft,
		headRef: input.wire.headRefName,
		baseRef: input.wire.baseRefName,
		headSha: headShaOf(input.wire),
		mergeable: mergeableFromWire(input.wire.mergeable),
		reviewDecision: input.wire.reviewDecision,
		unresolvedThreadCount: threads.unresolved,
		resolvedThreadCount: threads.resolved,
		changesRequestedReviews: toChangesRequestedReviews(input.wire.latestReviews.nodes),
		merge: toMergeState(input),
	}
}

// The Commit Status API reports one flat `StatusState` where a check run reports a status and a
// conclusion. `ERROR` and `FAILURE` both block the merge; `EXPECTED` has not reported yet.
// https://docs.github.com/en/graphql/reference/commits#enum-statusstate
const STATUS_STATE_AS_CHECK: Record<
	GitHubStatusContextWireType['state'],
	{ readonly status: CheckStatus; readonly conclusion: CheckConclusion | null }
> = {
	SUCCESS: { status: 'COMPLETED', conclusion: 'SUCCESS' },
	FAILURE: { status: 'COMPLETED', conclusion: 'FAILURE' },
	ERROR: { status: 'COMPLETED', conclusion: 'FAILURE' },
	PENDING: { status: 'IN_PROGRESS', conclusion: null },
	EXPECTED: { status: 'PENDING', conclusion: null },
}

export const toCheckRow = (context: GitHubStatusCheckRollupContextWireType, headSha: string): CheckRowType => {
	if (context.__typename === 'CheckRun') {
		return {
			id: checkRowId({ kind: 'check_run', name: context.name }),
			name: context.name,
			headSha,
			status: context.status,
			conclusion: context.conclusion,
			detailsUrl: context.detailsUrl,
			startedAt: context.startedAt,
			completedAt: context.completedAt,
		}
	}
	const derived = STATUS_STATE_AS_CHECK[context.state]
	return {
		id: checkRowId({ kind: 'status_context', name: context.context }),
		name: context.context,
		headSha,
		status: derived.status,
		conclusion: derived.conclusion,
		detailsUrl: context.targetUrl,
		startedAt: context.createdAt,
		completedAt: derived.status === 'COMPLETED' ? context.createdAt : null,
	}
}

export const toCheckRows = (wire: GitHubPullRequestWire): CheckRowType[] => {
	const commit = wire.commits.nodes[0]?.commit
	const contexts = commit?.statusCheckRollup?.contexts.nodes ?? []
	const headSha = headShaOf(wire)
	return contexts.filter((context) => context !== null).map((context) => toCheckRow(context, headSha))
}

export const toCheckRowFromWebhook = (input: {
	readonly name: string
	readonly headSha: string
	readonly status: CheckStatus
	readonly conclusion: CheckConclusion | null
	readonly detailsUrl: string | null
	readonly startedAt: string | null
	readonly completedAt: string | null
}): CheckRowType => ({
	id: checkRowId({ kind: 'check_run', name: input.name }),
	name: input.name,
	headSha: input.headSha,
	status: input.status,
	conclusion: input.conclusion,
	detailsUrl: input.detailsUrl,
	startedAt: input.startedAt,
	completedAt: input.completedAt,
})

// GraphQL spells these upper case and webhook payloads lower case. A value GitHub adds later is
// a dropped update, not a rejected delivery.
export const checkStatusFromWebhook = (status: string): CheckStatus | null =>
	CHECK_STATUSES.find((candidate) => candidate === status.toUpperCase()) ?? null

export const checkConclusionFromWebhook = (conclusion: string): CheckConclusion | null =>
	CHECK_CONCLUSIONS.find((candidate) => candidate === conclusion.toUpperCase()) ?? null
