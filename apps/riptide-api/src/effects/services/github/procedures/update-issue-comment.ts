import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import { GitHubIssueCommentWire, parseGitHubJsonPreservingIntegerLexemes } from '../github.schema'

export const updateIssueComment = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly repositoryFullName: string
	readonly commentId: string
	readonly body: string
}) =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const repositoryPath = input.repositoryFullName.split('/').map(encodeURIComponent).join('/')
		const url = new URL(
			`/repos/${repositoryPath}/issues/comments/${encodeURIComponent(input.commentId)}`,
			input.apiBaseUrl,
		)
		const request = HttpClientRequest.patch(url.toString()).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.installationToken)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
			HttpClientRequest.bodyJsonUnsafe({ body: input.body }),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(
				Effect.mapError(
					(cause) => new GitHubProviderTransportError({ operation: 'update_issue_comment', cause }),
				),
			)
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'update_issue_comment', status: response.status }),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'update_issue_comment', cause })),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'update_issue_comment', cause }),
		})
		return yield* Schema.decodeUnknownEffect(GitHubIssueCommentWire)(parsedBody).pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'update_issue_comment', cause })),
		)
	}).pipe(
		Effect.withSpan('github.api.update_issue_comment', {
			attributes: { repository_full_name: input.repositoryFullName, comment_id: input.commentId },
		}),
	)
