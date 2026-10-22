import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as Schema from 'effect/Schema'

import { GitHubProviderDecodeError, GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'
import {
	GitHubInstallationRepositoriesWire,
	parseGitHubJsonPreservingIntegerLexemes,
	type GitHubRepository,
} from '../github.schema'

export const listInstallationRepositoriesPage = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
	readonly page: number
	readonly perPage?: number
}): Effect.Effect<
	{ readonly totalCount: number; readonly repositories: ReadonlyArray<GitHubRepository> },
	GitHubProviderTransportError | GitHubProviderResponseError | GitHubProviderDecodeError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const url = new URL('/installation/repositories', input.apiBaseUrl)
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
					(cause) => new GitHubProviderTransportError({ operation: 'list_installation_repositories', cause }),
				),
			)
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({
					operation: 'list_installation_repositories',
					status: response.status,
				}),
			)
		}
		const body = yield* response.text.pipe(
			Effect.mapError(
				(cause) => new GitHubProviderDecodeError({ operation: 'list_installation_repositories', cause }),
			),
		)
		const parsedBody = yield* Effect.try({
			try: () => parseGitHubJsonPreservingIntegerLexemes(body),
			catch: (cause) => new GitHubProviderDecodeError({ operation: 'list_installation_repositories', cause }),
		})
		const wire = yield* Effect.succeed(parsedBody).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(GitHubInstallationRepositoriesWire)),
			Effect.mapError(
				(cause) => new GitHubProviderDecodeError({ operation: 'list_installation_repositories', cause }),
			),
		)
		const totalCount = Number(wire.total_count)
		if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
			return yield* Effect.fail(
				new GitHubProviderDecodeError({
					operation: 'list_installation_repositories',
					cause: 'invalid_total_count',
				}),
			)
		}
		return {
			totalCount,
			repositories: wire.repositories.map((repository) => ({
				id: repository.id,
				ownerLogin: repository.owner.login,
				name: repository.name,
				fullName: repository.full_name,
				private: repository.private,
				defaultBranch: repository.default_branch,
				archived: repository.archived,
			})),
		}
	}).pipe(
		Effect.withSpan('github.api.list_installation_repositories', {
			attributes: { page: input.page },
		}),
	)
