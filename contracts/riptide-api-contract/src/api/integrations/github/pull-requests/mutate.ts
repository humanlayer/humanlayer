import z from 'zod/v4'

import { contractBuilder } from '../../../../contract-builder'
import { PullRequestScopeSchema } from './ensure-stream'
import { MergeMethodSchema, PanelPullRequestSchema } from './list-branches'

/** GitHub caps a commit headline well above this; the merge box's own input stops here too. */
const COMMIT_HEADLINE_MAX_LENGTH = 256
const COMMIT_BODY_MAX_LENGTH = 65_536

const MergeCommitInputSchema = z.object({
	method: MergeMethodSchema,
	/** Omitted for a rebase, which has no commit of its own; GitHub's default when empty. */
	commitHeadline: z.string().max(COMMIT_HEADLINE_MAX_LENGTH).optional(),
	commitBody: z.string().max(COMMIT_BODY_MAX_LENGTH).optional(),
})

/**
 * Every write the GitHub tab makes, each one GitHub call made as the App. `expectedHeadSha` is
 * the head the user looked at: GitHub refuses the merge or update if the branch moved since.
 */
export const PullRequestMutationSchema = z.discriminatedUnion('type', [
	MergeCommitInputSchema.extend({ type: z.literal('merge'), expectedHeadSha: z.string().min(1) }),
	MergeCommitInputSchema.extend({ type: z.literal('enable_auto_merge') }),
	z.object({ type: z.literal('disable_auto_merge') }),
	z.object({ type: z.literal('update_branch'), expectedHeadSha: z.string().min(1) }),
	z.object({ type: z.literal('ready_for_review') }),
	z.object({ type: z.literal('convert_to_draft') }),
	z.object({ type: z.literal('close') }),
	z.object({ type: z.literal('reopen') }),
])
export type PullRequestMutation = z.infer<typeof PullRequestMutationSchema>
export type PullRequestMutationType = PullRequestMutation['type']

/**
 * The write is scoped the way the panel's read is: the branch must be one the caller's session or
 * task has been observed on. Riptide writes as the App, whose grant is the installation's rather
 * than the caller's, so the scope is what keeps a member to the pull requests they are working on.
 */
export const MutatePullRequestInputSchema = z.intersection(
	PullRequestScopeSchema,
	z.object({
		repoFullName: z.string().min(3),
		branch: z.string().min(1),
		number: z.number().int().positive(),
		mutation: PullRequestMutationSchema,
	}),
)
export type MutatePullRequestInput = z.infer<typeof MutatePullRequestInputSchema>

/** The pull request as GitHub reports it right after the write; the stream carries the same row. */
export const MutatePullRequestOutputSchema = z.object({
	pullRequest: PanelPullRequestSchema,
})

export const mutatePullRequestContract = contractBuilder
	.input(MutatePullRequestInputSchema)
	.output(MutatePullRequestOutputSchema)
