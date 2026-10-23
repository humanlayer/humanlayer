import z from 'zod/v4'

import { contractBuilder } from '../../../../contract-builder'
import { PullRequestScopeSchema } from './ensure-stream'

export const MergeMethodSchema = z.enum(['MERGE', 'SQUASH', 'REBASE'])
export type MergeMethod = z.infer<typeof MergeMethodSchema>

/** As `PullRequestMergeState` in @humanlayer/streams/pr-status. */
export const PanelPullRequestMergeStateSchema = z.object({
	mergeStateStatus: z.enum(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']),
	autoMergeRequest: z
		.object({ enabledBy: z.object({ login: z.string() }).nullable(), mergeMethod: MergeMethodSchema })
		.nullable(),
	viewerCanEnableAutoMerge: z.boolean(),
	viewerCanDisableAutoMerge: z.boolean(),
	viewerCanUpdateBranch: z.boolean(),
	mergeHeadline: z.string(),
	mergeBody: z.string(),
	squashHeadline: z.string(),
	squashBody: z.string(),
	commitCount: z.number().int(),
	mergeCommitAllowed: z.boolean(),
	squashMergeAllowed: z.boolean(),
	rebaseMergeAllowed: z.boolean(),
	viewerDefaultMergeMethod: MergeMethodSchema,
})

/** The pull request row the panel renders, as `PullRequestRow` in @humanlayer/streams/pr-status. */
export const PanelPullRequestSchema = z.object({
	id: z.string(),
	number: z.number().int(),
	title: z.string(),
	url: z.string(),
	state: z.enum(['open', 'closed', 'merged']),
	isDraft: z.boolean(),
	headRef: z.string(),
	baseRef: z.string(),
	headSha: z.string(),
	mergeable: z.boolean().nullable(),
	reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
	/** Null until a panel query has counted them. */
	unresolvedThreadCount: z.number().int().nullable(),
	resolvedThreadCount: z.number().int().nullable(),
	/** Reviewers whose latest review requested changes with a body, newest first; null until read. */
	changesRequestedReviews: z
		.array(
			z.object({
				login: z.string().nullable(),
				body: z.string(),
				submittedAt: z.string().nullable(),
				url: z.string().nullable(),
			}),
		)
		.nullable(),
	/** Null until a panel query has asked GitHub how the pull request merges. */
	merge: PanelPullRequestMergeStateSchema.nullable(),
})
export type PanelPullRequest = z.infer<typeof PanelPullRequestSchema>

export const PullRequestBranchSchema = z.object({
	repoFullName: z.string(),
	branch: z.string(),
	/**
	 * The branch HEAD points at in the session's checkout right now; for a task, in any of its
	 * sessions' checkouts. False for a branch that was moved away from.
	 */
	isCurrent: z.boolean(),
	/**
	 * True when an active GitHub App installation covers the repository. False names a branch the
	 * daemon observed in a repository GitHub cannot yet be asked about: no pull request is recorded
	 * for it and no status stream can be opened until the installation exists.
	 */
	installed: z.boolean(),
	/** The sessions of the task that observed the branch, most recently first. */
	sessionIds: z.array(z.uuid()),
	/** The last state any source recorded for the branch's pull request; null before one exists. */
	pullRequest: PanelPullRequestSchema.nullable(),
	/**
	 * The branch's other recorded pull requests, newest first: a branch reused after its pull
	 * request merged has one per round. Optional because a desktop build can outlive the API it
	 * shipped against.
	 */
	earlierPullRequests: z.array(PanelPullRequestSchema).optional(),
})
export type PullRequestBranch = z.infer<typeof PullRequestBranchSchema>

export const ListPullRequestBranchesOutputSchema = z.object({
	/**
	 * The pull requests of the session's task, every session of it included, in order of affinity to
	 * the session asked for: its current branches, the branches it observed, the rest of the task's,
	 * then recorded branches nobody observed, each by recency. A session with no task lists its own.
	 */
	branches: z.array(PullRequestBranchSchema),
})

export const listPullRequestBranchesContract = contractBuilder
	.input(PullRequestScopeSchema)
	.output(ListPullRequestBranchesOutputSchema)
