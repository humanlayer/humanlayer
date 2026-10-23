import type { PullRequestMutation } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import type { MergeMethod } from '@humanlayer/streams/pr-status'
import { Effect, type Redacted } from 'effect'
import * as Schema from 'effect/Schema'

import {
	GitHubProviderDecodeError,
	GitHubPullRequestMutationRejectedError,
	GitHubPullRequestNotFoundError,
} from '../github.errors'
import { splitRepoFullName } from '../repo-name'
import { graphql, isGitHubGraphQLErrorsCause } from './graphql'

/**
 * Every write the GitHub tab makes, as one GraphQL mutation each, run as the App. GraphQL is the
 * only API that has ready-for-review and convert-to-draft, so the rest follow it rather than
 * splitting the writes across REST and GraphQL.
 */

export const PULL_REQUEST_NODE_ID_QUERY = `
	query RiptidePullRequestNodeId($owner: String!, $repo: String!, $number: Int!) {
		repository(owner: $owner, name: $repo) {
			pullRequest(number: $number) {
				id
			}
		}
	}
`

const GitHubPullRequestNodeIdResponse = Schema.Struct({
	repository: Schema.NullOr(
		Schema.Struct({
			pullRequest: Schema.NullOr(Schema.Struct({ id: Schema.String })),
		}),
	),
})

/** Every mutation answers with the pull request, so one document shape serves them all. */
const mutationDocument = (field: string, inputType: string) => `
	mutation Riptide${field[0]?.toUpperCase()}${field.slice(1)}($input: ${inputType}!) {
		${field}(input: $input) {
			pullRequest {
				number
			}
		}
	}
`

/** The message fields GitHub's merge and auto-merge inputs share. */
interface CommitMessageInput {
	commitHeadline?: string
	commitBody?: string
}

// An empty headline would replace GitHub's default with nothing, so only a written one is sent.
const withCommitMessage = <T extends object>(
	base: T,
	message: { readonly commitHeadline?: string; readonly commitBody?: string },
): T & CommitMessageInput => {
	const input: T & CommitMessageInput = { ...base }
	if (message.commitHeadline) input.commitHeadline = message.commitHeadline
	if (message.commitBody !== undefined) input.commitBody = message.commitBody
	return input
}

/** GitHub's input object for each mutation, by the fields the mutation takes. */
export type PullRequestMutationInput =
	| ({
			readonly pullRequestId: string
			readonly mergeMethod: MergeMethod
			readonly expectedHeadOid: string
	  } & CommitMessageInput)
	| ({ readonly pullRequestId: string; readonly mergeMethod: MergeMethod } & CommitMessageInput)
	| { readonly pullRequestId: string; readonly updateMethod: 'MERGE'; readonly expectedHeadOid: string }
	| { readonly pullRequestId: string }

/** One GraphQL mutation and the input it takes, so an action is written in one place. */
export interface PullRequestMutationRequest {
	readonly query: string
	readonly input: PullRequestMutationInput
}

export const toMutationRequest = (pullRequestId: string, mutation: PullRequestMutation): PullRequestMutationRequest => {
	switch (mutation.type) {
		case 'merge':
			return {
				query: mutationDocument('mergePullRequest', 'MergePullRequestInput'),
				input: withCommitMessage(
					{ pullRequestId, mergeMethod: mutation.method, expectedHeadOid: mutation.expectedHeadSha },
					mutation,
				),
			}
		case 'enable_auto_merge':
			return {
				query: mutationDocument('enablePullRequestAutoMerge', 'EnablePullRequestAutoMergeInput'),
				input: withCommitMessage({ pullRequestId, mergeMethod: mutation.method }, mutation),
			}
		case 'disable_auto_merge':
			return {
				query: mutationDocument('disablePullRequestAutoMerge', 'DisablePullRequestAutoMergeInput'),
				input: { pullRequestId },
			}
		case 'update_branch':
			return {
				query: mutationDocument('updatePullRequestBranch', 'UpdatePullRequestBranchInput'),
				input: { pullRequestId, updateMethod: 'MERGE', expectedHeadOid: mutation.expectedHeadSha },
			}
		case 'ready_for_review':
			return {
				query: mutationDocument('markPullRequestReadyForReview', 'MarkPullRequestReadyForReviewInput'),
				input: { pullRequestId },
			}
		case 'convert_to_draft':
			return {
				query: mutationDocument('convertPullRequestToDraft', 'ConvertPullRequestToDraftInput'),
				input: { pullRequestId },
			}
		case 'close':
			return { query: mutationDocument('closePullRequest', 'ClosePullRequestInput'), input: { pullRequestId } }
		case 'reopen':
			return { query: mutationDocument('reopenPullRequest', 'ReopenPullRequestInput'), input: { pullRequestId } }
	}
}

/**
 * A mutation GitHub declines comes back as `errors[]` on a 200, which the GraphQL runner reports
 * as a decode failure carrying them; their messages are what the user needs to read.
 */
const rejectionMessage = (error: GitHubProviderDecodeError): string | null =>
	isGitHubGraphQLErrorsCause(error.cause) ? error.cause.messages : null

export const mutatePullRequestOnGitHub = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly repoFullName: string
	readonly number: number
	readonly mutation: PullRequestMutation
}) =>
	Effect.gen(function* () {
		const repository = splitRepoFullName(input.repoFullName)
		if (!repository) {
			return yield* Effect.fail(
				new GitHubProviderDecodeError({ operation: 'mutate_pull_request', cause: 'invalid_repo_full_name' }),
			)
		}
		const located = yield* graphql({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: input.installationToken,
			operation: 'resolve_pull_request_node_id',
			query: PULL_REQUEST_NODE_ID_QUERY,
			variables: { owner: repository.owner, repo: repository.repo, number: input.number },
			schema: GitHubPullRequestNodeIdResponse,
		})
		const pullRequestId = located.repository?.pullRequest?.id
		if (!pullRequestId) {
			return yield* Effect.fail(
				new GitHubPullRequestNotFoundError({ repoFullName: input.repoFullName, number: input.number }),
			)
		}
		const request = toMutationRequest(pullRequestId, input.mutation)
		yield* graphql({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: input.installationToken,
			operation: `mutate_pull_request.${input.mutation.type}`,
			query: request.query,
			variables: { input: request.input },
			schema: Schema.Unknown,
		}).pipe(
			Effect.catchTag('GitHubProviderDecodeError', (error) => {
				const message = rejectionMessage(error)
				return Effect.fail(
					message === null
						? error
						: new GitHubPullRequestMutationRejectedError({ mutation: input.mutation.type, message }),
				)
			}),
		)
	}).pipe(
		Effect.withSpan('github.api.mutate_pull_request', {
			attributes: {
				repository_full_name: input.repoFullName,
				number: input.number,
				mutation: input.mutation.type,
			},
		}),
	)
