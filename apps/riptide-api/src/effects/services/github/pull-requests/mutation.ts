import type { PullRequestMutation } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import { Effect } from 'effect'
import type * as HttpClient from 'effect/http/HttpClient'

import { Sentry } from '../../../../instrument'
import type { PostgresDb } from '../../postgres/postgres-db.service'
import { getOrRefreshGitHubInstallationToken } from '../github.auth'
import {
	type GitHubConnectionNotFoundError,
	GitHubIntegrationUnavailableError,
	GitHubMissingPermissionsError,
	type GitHubProviderAccessBlockedError,
	type GitHubProviderError,
	type GitHubProviderForbiddenError,
	GitHubRepositoryAccessBlockedError,
	type GitHubPullRequestMutationRejectedError,
	type GitHubPullRequestNotFoundError,
	type GitHubRepositoryNotAccessibleError,
} from '../github.errors'
import {
	checkGitHubCapabilities,
	type GitHubCapability,
	missingPermissionNames,
	refusedGitHubCapabilities,
} from '../github.permissions'
import { findConnectionForRepository } from '../github.persistence'
import type { GitHubInstallationPermissions } from '../github.schema'
import { fetchPullRequest } from '../procedures/fetch-pull-request'
import { mutatePullRequestOnGitHub } from '../procedures/mutate-pull-request'
import { type FetchedPullRequest, PULL_REQUEST_PANEL_CAPABILITIES } from './github-api'

/**
 * One write to a pull request as the App, then GitHub's answer for the branch afterwards. The
 * caller records and publishes that answer, so every watcher sees the result of the write before
 * the webhook for it arrives.
 */

/**
 * The grants every write needs. Contents write covers merging and updating the branch, and
 * every installation holding Pull requests write holds it too: the App has asked for both since
 * its first version, and GitHub grants an App's permissions as one set. Every write is confirmed
 * with the panel query afterwards, so it needs what that query reads as well.
 */
export const PULL_REQUEST_WRITE_CAPABILITIES: readonly GitHubCapability[] = [
	'writePullRequests',
	'writeContents',
	...PULL_REQUEST_PANEL_CAPABILITIES,
]

/**
 * GitHub refused nodes the write or its confirming read selected, after the guard found the
 * persisted grant sufficient: the installation holds an older grant set than the row records.
 * The caller is prompted to refresh the connection, so this is logged with the refused paths
 * rather than captured as a failure.
 */
const failRefusedCapabilities = (
	error: GitHubProviderForbiddenError,
	permissions: GitHubInstallationPermissions,
	capabilities: readonly GitHubCapability[],
	attributes: Record<string, string | number>,
) => {
	const refused = refusedGitHubCapabilities(permissions, capabilities)
	return Effect.logWarning('GitHub refused pull request write nodes').pipe(
		Effect.annotateLogs({
			operation: 'mutate_pull_request',
			...attributes,
			refused_paths: error.paths.join(' | '),
			refusal_messages: error.messages,
			declared_permissions: missingPermissionNames(refused),
		}),
		Effect.andThen(
			Effect.fail(new GitHubMissingPermissionsError({ missing: refused, detectedBy: 'github_refusal' })),
		),
	)
}

const captureProviderFailure = (error: GitHubProviderError, attributes: Record<string, string | number>) =>
	Effect.logError('GitHub pull request write failed', error).pipe(
		Effect.annotateLogs({ operation: 'mutate_pull_request', ...attributes }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github', operation: 'mutate_pull_request' },
					extra: attributes,
				}),
			),
		),
		Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
	)

export const mutatePullRequest = (input: {
	readonly organizationId: string
	readonly repoFullName: string
	readonly branch: string
	readonly number: number
	readonly mutation: PullRequestMutation
	readonly apiBaseUrl: URL
	readonly issuer: string
	readonly signingKey: CryptoKey
}): Effect.Effect<
	FetchedPullRequest | null,
	| GitHubConnectionNotFoundError
	| GitHubRepositoryNotAccessibleError
	| GitHubMissingPermissionsError
	| GitHubRepositoryAccessBlockedError
	| GitHubPullRequestNotFoundError
	| GitHubPullRequestMutationRejectedError
	| GitHubIntegrationUnavailableError,
	PostgresDb | HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const connection = yield* findConnectionForRepository({
			organizationId: input.organizationId,
			repoFullName: input.repoFullName,
		})
		const missing = checkGitHubCapabilities(connection.permissions, PULL_REQUEST_WRITE_CAPABILITIES)
		if (missing.length > 0) {
			return yield* Effect.fail(new GitHubMissingPermissionsError({ missing, detectedBy: 'installation_grant' }))
		}
		const installationToken = yield* getOrRefreshGitHubInstallationToken({
			organizationId: input.organizationId,
			connectionId: connection.id,
			apiBaseUrl: input.apiBaseUrl,
			issuer: input.issuer,
			signingKey: input.signingKey,
		})
		const attributes = {
			repo_full_name: input.repoFullName,
			number: input.number,
			mutation: input.mutation.type,
		}
		// The write is confirmed with a read, and a refusal there is a refusal of what the panel
		// reads; attributed to the write it would say the App lacks write access after the write landed.
		const narrowProviderFailure = (capabilities: readonly GitHubCapability[]) => ({
			GitHubProviderAccessBlockedError: (error: GitHubProviderAccessBlockedError) =>
				Effect.logWarning('GitHub blocked the App from the repository').pipe(
					Effect.annotateLogs({
						operation: 'mutate_pull_request',
						...attributes,
						refusal_messages: error.messages,
					}),
					Effect.andThen(
						Effect.fail(
							new GitHubRepositoryAccessBlockedError({
								repoFullName: input.repoFullName,
								messages: error.messages,
							}),
						),
					),
				),
			GitHubProviderForbiddenError: (error: GitHubProviderForbiddenError) =>
				failRefusedCapabilities(error, connection.permissions, capabilities, attributes),
			GitHubProviderTransportError: (error: GitHubProviderError) => captureProviderFailure(error, attributes),
			GitHubProviderResponseError: (error: GitHubProviderError) => captureProviderFailure(error, attributes),
			GitHubProviderDecodeError: (error: GitHubProviderError) => captureProviderFailure(error, attributes),
		})
		yield* mutatePullRequestOnGitHub({
			apiBaseUrl: input.apiBaseUrl,
			installationToken,
			repoFullName: input.repoFullName,
			number: input.number,
			mutation: input.mutation,
		}).pipe(Effect.catchTags(narrowProviderFailure(PULL_REQUEST_WRITE_CAPABILITIES)))
		return yield* fetchPullRequest({
			apiBaseUrl: input.apiBaseUrl,
			installationToken,
			repoFullName: input.repoFullName,
			branch: input.branch,
		}).pipe(Effect.catchTags(narrowProviderFailure(PULL_REQUEST_PANEL_CAPABILITIES)))
	}).pipe(
		Effect.withSpan('github.mutate_pull_request', {
			attributes: {
				organization_id: input.organizationId,
				repo_full_name: input.repoFullName,
				number: input.number,
				mutation: input.mutation.type,
			},
		}),
	)
