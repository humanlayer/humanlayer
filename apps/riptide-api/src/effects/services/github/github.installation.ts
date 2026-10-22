import { Effect, Redacted } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'

import { Sentry } from '../../../instrument'
import type { PostgresDb } from '../postgres/postgres-db.service'
import { mintGitHubInstallationToken, signGitHubAppJwt } from './github.auth'
import {
	GitHubIntegrationUnavailableError,
	type GitHubConnectionConflictError,
	GitHubInstallStateInvalidError,
	type GitHubProviderError,
} from './github.errors'
import {
	claimAndBindInstallation,
	persistUnclaimedInstallation,
	reconcileGitHubInstallationState,
	validateGitHubInstallState,
} from './github.persistence'
import type { GitHubRepository } from './github.schema'
import type { GitHubInstallationCompletion } from './github.types'
import { getInstallation } from './procedures/get-installation'
import { listInstallationRepositoriesPage } from './procedures/list-installation-repositories'

type GitHubConnectionWorkflowError =
	| GitHubInstallStateInvalidError
	| GitHubConnectionConflictError
	| GitHubIntegrationUnavailableError

const captureProviderFailure = (error: GitHubProviderError) =>
	Effect.logError('GitHub provider operation failed', error).pipe(
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github' },
				}),
			),
		),
	)

export const listAllInstallationRepositories = (input: {
	readonly apiBaseUrl: URL
	readonly installationToken: Redacted.Redacted<string>
}): Effect.Effect<ReadonlyArray<GitHubRepository>, GitHubProviderError, HttpClient.HttpClient> => {
	const loadPage = (
		page: number,
		accumulated: ReadonlyArray<GitHubRepository>,
	): Effect.Effect<ReadonlyArray<GitHubRepository>, GitHubProviderError, HttpClient.HttpClient> =>
		listInstallationRepositoriesPage({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: input.installationToken,
			page,
		}).pipe(
			Effect.flatMap((result) => {
				const repositories = [...accumulated, ...result.repositories]
				return repositories.length >= result.totalCount || result.repositories.length === 0
					? Effect.succeed(repositories)
					: loadPage(page + 1, repositories)
			}),
		)
	return loadPage(1, []).pipe(Effect.withSpan('github.installation.list_all_repositories'))
}

export const completeGitHubInstallation = (input: {
	readonly installationId: string
	readonly state?: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<GitHubInstallationCompletion, GitHubConnectionWorkflowError, PostgresDb | HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const claim = input.state ? yield* validateGitHubInstallState(input.state) : undefined
		const appJwt = yield* signGitHubAppJwt({ issuer: input.issuer, signingKey: input.signingKey }).pipe(
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const installation = yield* getInstallation({
			apiBaseUrl: input.apiBaseUrl,
			installationId: input.installationId,
			appJwt,
		}).pipe(
			Effect.tapError(captureProviderFailure),
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const mintedToken = yield* mintGitHubInstallationToken({
			apiBaseUrl: input.apiBaseUrl,
			installationId: installation.id,
			issuer: input.issuer,
			signingKey: input.signingKey,
		}).pipe(Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })))
		const repositories = yield* listAllInstallationRepositories({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: mintedToken.token,
		}).pipe(
			Effect.tapError(captureProviderFailure),
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const token = { token: Redacted.value(mintedToken.token), expiresAt: mintedToken.expiresAt }

		if (!claim) {
			const persisted = yield* persistUnclaimedInstallation({ installation, token, repositories })
			return persisted.status === 'active'
				? { result: 'connected' as const, connectionId: persisted.id }
				: { result: 'unclaimed' as const }
		}

		const connectionId = yield* claimAndBindInstallation({ claim, installation, token, repositories }).pipe(
			Effect.catchTag('GitHubConnectionNotFoundError', () =>
				Effect.fail(new GitHubInstallStateInvalidError({ reason: 'invalid_or_expired' })),
			),
		)
		return { result: 'connected' as const, connectionId }
	}).pipe(
		Effect.tap((result) => Effect.annotateCurrentSpan({ result: result.result })),
		Effect.withSpan('github.complete_installation', {
			attributes: { installation_id: input.installationId, has_state: Boolean(input.state) },
		}),
	)

/**
 * Full canonical reconciliation for a single installation: authenticate as the app, fetch
 * GitHub's current installation metadata and permission grant, mint a fresh installation
 * token, paginate the complete repository inventory, then atomically replace the persisted
 * current state. No database transaction is held across the GitHub calls. This is the shared
 * engine for `installation.created`, `unsuspend`, `new_permissions_accepted`,
 * `installation_repositories`, and the explicit refresh action, so duplicate, retried, and
 * reordered notifications converge on GitHub's current state.
 */
export const reconcileInstallation = (input: {
	readonly installationId: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	{
		readonly id: string
		readonly status: 'active' | 'unclaimed' | 'suspended'
		readonly organizationId: string | null
	},
	GitHubIntegrationUnavailableError,
	PostgresDb | HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const appJwt = yield* signGitHubAppJwt({ issuer: input.issuer, signingKey: input.signingKey }).pipe(
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const installation = yield* getInstallation({
			apiBaseUrl: input.apiBaseUrl,
			installationId: input.installationId,
			appJwt,
		}).pipe(
			Effect.tapError(captureProviderFailure),
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const mintedToken = yield* mintGitHubInstallationToken({
			apiBaseUrl: input.apiBaseUrl,
			installationId: installation.id,
			issuer: input.issuer,
			signingKey: input.signingKey,
		}).pipe(Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })))
		const repositories = yield* listAllInstallationRepositories({
			apiBaseUrl: input.apiBaseUrl,
			installationToken: mintedToken.token,
		}).pipe(
			Effect.tapError(captureProviderFailure),
			Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
		)
		const token = { token: Redacted.value(mintedToken.token), expiresAt: mintedToken.expiresAt }
		return yield* reconcileGitHubInstallationState({ installation, token, repositories })
	}).pipe(
		Effect.withSpan('github.reconcile_installation', {
			attributes: { installation_id: input.installationId },
		}),
	)
