import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import { GitHubIssueCommentWire, parseGitHubJsonPreservingIntegerLexemes } from '../github.schema'

const GitHubIssueCommentsWire = Schema.Array(GitHubIssueCommentWire)

export const listIssueCommentsPage = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly repositoryFullName: string
	readonly issueNumber: number
	readonly page: number
	readonly perPage?: number
}) =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const url = new URL(
			`/repos/${input.repositoryFullName.split('/').map(encodeURIComponent).join('/')}/issues/${input.issueNumber}/comments`,
			input.apiBaseUrl,
		)
		url.searchParams.set('page', String(input.page))
		url.searchParams.set('per_page', String(input.perPage ?? 100))
		const request = HttpClientRequest.get(url.toString()).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.installationToken)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(
				Effect.mapError(
					(cause) => new GitHubProviderTransportError({ operation: 'list_issue_comments', cause }),
				),
			)
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'list_issue_comments', status: response.status }),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'list_issue_comments', cause })),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'list_issue_comments', cause }),
		})
		return yield* Schema.decodeUnknownEffect(GitHubIssueCommentsWire)(parsedBody).pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'list_issue_comments', cause })),
		)
	}).pipe(
		Effect.withSpan('github.api.list_issue_comments', {
			attributes: {
				repository_full_name: input.repositoryFullName,
				issue_number: input.issueNumber,
				page: input.page,
			},
		}),
	)
