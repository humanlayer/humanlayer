import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import {
	GitHubInstallationTokenWire,
	parseGitHubJsonPreservingIntegerLexemes,
	type GitHubInstallationToken,
} from '../github.schema'

export const createInstallationToken = (input: {
	readonly apiBaseUrl: URL
	readonly installationId: string
	readonly appJwt: Redacted.Redacted<string>
}): Effect.Effect<
	GitHubInstallationToken,
	GitHubProviderTransportError | GitHubProviderResponseError | GitHubProviderDecodeError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const request = HttpClientRequest.post(
			new URL(
				`/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
				input.apiBaseUrl,
			).toString(),
		).pipe(
			HttpClientRequest.bearerToken(Redacted.value(input.appJwt)),
			HttpClientRequest.setHeader('Accept', 'application/vnd.github+json'),
			HttpClientRequest.setHeader('X-GitHub-Api-Version', '2022-11-28'),
			HttpClientRequest.setHeader('User-Agent', 'HumanLayer-Riptide'),
		)
		const response = yield* httpClient
			.execute(request)
			.pipe(
				Effect.mapError(
					(cause) => new GitHubProviderTransportError({ operation: 'create_installation_token', cause }),
				),
			)
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'create_installation_token', status: response.status }),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError(
				(cause) => new GitHubProviderDecodeError({ operation: 'create_installation_token', cause }),
			),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'create_installation_token', cause }),
		})
		const wire = yield* Effect.succeed(parsedBody).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(GitHubInstallationTokenWire)),
			Effect.mapError(
				(cause) => new GitHubProviderDecodeError({ operation: 'create_installation_token', cause }),
			),
		)
		const expiresAt = Date.parse(wire.expires_at)
		if (!Number.isFinite(expiresAt)) {
			return yield* Effect.fail(
				new GitHubProviderDecodeError({
					operation: 'create_installation_token',
					cause: 'invalid_expires_at',
				}),
			)
		}
		return { token: wire.token, expiresAt }
	}).pipe(
		Effect.withSpan('github.api.create_installation_token', {
			attributes: { installation_id: input.installationId },
		}),
	)
