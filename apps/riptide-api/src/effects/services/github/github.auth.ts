import { Clock, Effect, Redacted } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'
import { SignJWT } from 'jose'

import { Sentry } from '../../../instrument'
import type { PostgresDb } from '../postgres/postgres-db.service'
import {
	GitHubConnectionNotFoundError,
	GitHubIntegrationUnavailableError,
	GitHubJwtSigningError,
	type GitHubProviderError,
} from './github.errors'
import { loadGitHubTokenState, persistRefreshedGitHubToken } from './github.persistence'
import { createInstallationToken } from './procedures/create-installation-token'

const APP_JWT_LIFETIME_SECONDS = 9 * 60
const TOKEN_REFRESH_WINDOW_MILLIS = 5 * 60 * 1000

const captureGitHubAuthenticationFailure = (
	error: GitHubJwtSigningError | GitHubProviderError,
	operation: string,
	attributes: Readonly<Record<string, string>> = {},
) =>
	Effect.logError('GitHub authentication operation failed', error).pipe(
		Effect.annotateLogs({ operation, ...attributes }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github', operation },
					extra: attributes,
				}),
			),
		),
	)

export const signGitHubAppJwt = (input: { readonly issuer: string; readonly signingKey: CryptoKey }) =>
	Effect.gen(function* () {
		const nowMillis = yield* Clock.currentTimeMillis
		const issuedAt = Math.floor(nowMillis / 1000) - 60
		return yield* Effect.tryPromise({
			try: () =>
				new SignJWT({})
					.setProtectedHeader({ alg: 'RS256' })
					.setIssuer(input.issuer)
					.setIssuedAt(issuedAt)
					.setExpirationTime(issuedAt + APP_JWT_LIFETIME_SECONDS)
					.sign(input.signingKey),
			catch: (cause) => new GitHubJwtSigningError({ cause }),
		})
	}).pipe(
		Effect.tapError((error) => captureGitHubAuthenticationFailure(error, 'sign_app_jwt')),
		Effect.map(Redacted.make),
		Effect.withSpan('github.auth.sign_app_jwt'),
	)

export const mintGitHubInstallationToken = (input: {
	readonly apiBaseUrl: URL
	readonly installationId: string
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	{ readonly token: Redacted.Redacted<string>; readonly expiresAt: number },
	GitHubJwtSigningError | GitHubProviderError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const appJwt = yield* signGitHubAppJwt({ issuer: input.issuer, signingKey: input.signingKey })
		const token = yield* createInstallationToken({
			apiBaseUrl: input.apiBaseUrl,
			installationId: input.installationId,
			appJwt,
		}).pipe(
			Effect.tapError((error) =>
				captureGitHubAuthenticationFailure(error, 'create_installation_token', {
					installation_id: input.installationId,
				}),
			),
		)
		return { token: Redacted.make(token.token), expiresAt: token.expiresAt }
	}).pipe(
		Effect.withSpan('github.auth.mint_installation_token', {
			attributes: { installation_id: input.installationId },
		}),
	)

export const getOrRefreshGitHubInstallationToken = (input: {
	readonly organizationId: string
	readonly connectionId: string
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	Redacted.Redacted<string>,
	GitHubConnectionNotFoundError | GitHubIntegrationUnavailableError,
	PostgresDb | HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const connection = yield* loadGitHubTokenState(input)
		const now = yield* Clock.currentTimeMillis
		if (
			connection.access_token &&
			connection.token_expires_at &&
			Number(connection.token_expires_at) - now > TOKEN_REFRESH_WINDOW_MILLIS
		) {
			return Redacted.make(connection.access_token)
		}

		const refreshed = yield* mintGitHubInstallationToken({
			apiBaseUrl: input.apiBaseUrl,
			installationId: connection.installation_id,
			issuer: input.issuer,
			signingKey: input.signingKey,
		}).pipe(Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })))
		const persisted = yield* persistRefreshedGitHubToken({
			connectionId: connection.id,
			observedGeneration: connection.token_generation,
			token: { token: Redacted.value(refreshed.token), expiresAt: refreshed.expiresAt },
		})
		if (!persisted.access_token) {
			return yield* Effect.fail(new GitHubIntegrationUnavailableError({ cause: 'token_refresh_not_persisted' }))
		}
		return Redacted.make(persisted.access_token)
	}).pipe(
		Effect.withSpan('github.auth.get_or_refresh_installation_token', {
			attributes: { organization_id: input.organizationId, connection_id: input.connectionId },
		}),
	)
