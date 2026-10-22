import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import {
	GitHubInstallationWire,
	parseGitHubJsonPreservingIntegerLexemes,
	type GitHubInstallation,
} from '../github.schema'

export const getInstallation = (input: {
	readonly apiBaseUrl: URL
	readonly installationId: string
	readonly appJwt: Redacted.Redacted<string>
}): Effect.Effect<
	GitHubInstallation,
	GitHubProviderTransportError | GitHubProviderResponseError | GitHubProviderDecodeError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const request = HttpClientRequest.get(
			new URL(`/app/installations/${encodeURIComponent(input.installationId)}`, input.apiBaseUrl).toString(),
		).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.appJwt)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(
				Effect.mapError((cause) => new GitHubProviderTransportError({ operation: 'get_installation', cause })),
			)
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'get_installation', status: response.status }),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'get_installation', cause })),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'get_installation', cause }),
		})
		const wire = yield* Effect.succeed(parsedBody).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(GitHubInstallationWire)),
			Effect.mapError((cause) => new GitHubProviderDecodeError({ operation: 'get_installation', cause })),
		)
		return {
			id: wire.id,
			account: {
				id: wire.account.id,
				login: wire.account.login,
				type: wire.account.type,
			},
			repositorySelection: wire.repository_selection,
			permissions: wire.permissions,
		}
	}).pipe(
		Effect.withSpan('github.api.get_installation', {
			attributes: { installation_id: input.installationId },
		}),
	)
