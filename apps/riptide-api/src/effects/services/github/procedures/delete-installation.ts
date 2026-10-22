import { Effect, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'

import { GitHubProviderResponseError, GitHubProviderTransportError } from '../github.errors'

/**
 * The classified outcome of an app-authenticated uninstall request. GitHub returns `204` when
 * it deletes the installation and `404` when the installation is already gone; both confirm
 * the installation no longer exists, so local cleanup may proceed idempotently.
 */
export type GitHubDeleteInstallationResult = { readonly result: 'deleted' | 'already_gone' }

/**
 * `DELETE /app/installations/{installation_id}` using an app JWT. Only the app identity (not
 * an installation token) can delete an installation, and this works regardless of suspension.
 * A non-204/404 status becomes a rich provider error so the caller can preserve local state
 * and surface a retry.
 */
export const deleteInstallation = (input: {
	readonly apiBaseUrl: URL
	readonly installationId: string
	readonly appJwt: Redacted.Redacted<string>
}): Effect.Effect<
	GitHubDeleteInstallationResult,
	GitHubProviderTransportError | GitHubProviderResponseError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const httpClient = yield* HttpClient.HttpClient
		const request = HttpClientRequest.delete(
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
				Effect.mapError(
					(cause) => new GitHubProviderTransportError({ operation: 'delete_installation', cause }),
				),
			)
		if (response.status === 404) {
			return { result: 'already_gone' as const }
		}
		if (response.status < 200 || response.status >= 300) {
			return yield* Effect.fail(
				new GitHubProviderResponseError({ operation: 'delete_installation', status: response.status }),
			)
		}
		return { result: 'deleted' as const }
	}).pipe(
		Effect.withSpan('github.api.delete_installation', {
			attributes: { installation_id: input.installationId },
		}),
	)
