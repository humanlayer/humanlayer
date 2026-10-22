import { Effect, type Redacted } from 'effect'

import { GitHubProviderDecodeError } from '../github.errors'
import {
	type FetchedPullRequest,
	GitHubPullRequestPanelResponse,
	GitHubPullRequestReviewThreadsResponse,
	type GitHubReviewThreadsWire,
	PULL_REQUEST_PANEL_QUERY,
	PULL_REQUEST_REVIEW_THREADS_QUERY,
	selectPanelPullRequest,
} from '../pull-requests/github-api'
import { splitRepoFullName } from '../repo-name'
import { graphql } from './graphql'

const OPERATION = 'fetch_pull_request'
const THREADS_OPERATION = 'fetch_pull_request_review_threads'
// A thousand threads is beyond any pull request the panel should count; past it the count is a floor.
const MAX_REVIEW_THREAD_PAGES = 10

const fetchMoreReviewThreads = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly owner: string
	readonly repo: string
	readonly number: number
	readonly firstPage: GitHubReviewThreadsWire
}) =>
	Effect.gen(function* () {
		const pages: GitHubReviewThreadsWire[] = []
		let cursor = input.firstPage.pageInfo.hasNextPage ? input.firstPage.pageInfo.endCursor : null
		while (cursor !== null && pages.length < MAX_REVIEW_THREAD_PAGES - 1) {
			const decoded = yield* graphql({
				apiBaseUrl: input.apiBaseUrl,
				installationToken: input.installationToken,
				operation: THREADS_OPERATION,
				query: PULL_REQUEST_REVIEW_THREADS_QUERY,
				variables: { owner: input.owner, repo: input.repo, number: input.number, after: cursor },
				schema: GitHubPullRequestReviewThreadsResponse,
			})
			const page = decoded.repository?.pullRequest?.reviewThreads
			if (!page) break
			pages.push(page)
			cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
		}
		return pages
	})

export const fetchPullRequest = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly repoFullName: string
	readonly branch: string
}) =>
	Effect.gen(function* () {
		const repository = splitRepoFullName(input.repoFullName)
		if (!repository) {
			return yield* Effect.fail(
				new GitHubProviderDecodeError({ operation: OPERATION, cause: 'invalid_repo_full_name' }),
			)
		}
		const decoded = yield* graphql({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: input.installationToken,
			operation: OPERATION,
			query: PULL_REQUEST_PANEL_QUERY,
			variables: { owner: repository.owner, repo: repository.repo, branch: input.branch },
			schema: GitHubPullRequestPanelResponse,
		})
		const repositoryOnGitHub = decoded.repository
		if (!repositoryOnGitHub) return null
		const wire = selectPanelPullRequest({
			nodes: repositoryOnGitHub.pullRequests.nodes,
			repoFullName: input.repoFullName,
		})
		if (!wire) return null
		const moreReviewThreads = yield* fetchMoreReviewThreads({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: input.installationToken,
			owner: repository.owner,
			repo: repository.repo,
			number: wire.number,
			firstPage: wire.reviewThreads,
		})
		// The repository's merge settings ride along: they are the same for every pull request in
		// it, and the row cannot say which methods are offered without them.
		const fetched: FetchedPullRequest = {
			wire,
			moreReviewThreads,
			repository: {
				mergeCommitAllowed: repositoryOnGitHub.mergeCommitAllowed,
				squashMergeAllowed: repositoryOnGitHub.squashMergeAllowed,
				rebaseMergeAllowed: repositoryOnGitHub.rebaseMergeAllowed,
				viewerDefaultMergeMethod: repositoryOnGitHub.viewerDefaultMergeMethod,
			},
		}
		return fetched
	}).pipe(
		Effect.withSpan('github.api.fetch_pull_request', {
			attributes: { repository_full_name: input.repoFullName, branch: input.branch },
		}),
	)
