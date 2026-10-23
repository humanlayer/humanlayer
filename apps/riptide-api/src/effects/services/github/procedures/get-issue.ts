import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import { GitHubIssueWire, parseGitHubJsonPreservingIntegerLexemes } from '../github.schema'

export const getIssue = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly repositoryFullName: string
	readonly issueNumber: number
}) =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const url = new URL(
			`/repos/${input.repositoryFullName.split('/').map(encodeURIComponent).join('/')}/issues/${input.issueNumber}`,
			input.apiBaseUrl,
		)
		const request = HttpClientRequest.get(url.toString()).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.installationToken)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(Effect.mapError((cause) => new GitHubProviderTransportError({ operation: 'get_issue', cause })))
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'get_issue', status: response.status }),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'get_issue', cause })),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'get_issue', cause }),
		})
		const wire = yield* Schema.decodeUnknownEffect(GitHubIssueWire)(parsedBody).pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'get_issue', cause })),
		)
		const issueNumber = Number(wire.number)
		if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
			return yield* Effect.fail(
				new GitHubProviderDecodeError({ operation: 'get_issue', cause: 'invalid_issue_number' }),
			)
		}
		return { ...wire, number: issueNumber }
	}).pipe(
		Effect.withSpan('github.api.get_issue', {
			attributes: { repository_full_name: input.repositoryFullName, issue_number: input.issueNumber },
		}),
	)
