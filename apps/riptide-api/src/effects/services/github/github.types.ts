import type { PullRequestMutation } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/mutate'
import type { Effect } from 'effect'
import type { HttpClient } from 'effect/http/HttpClient'

import type { PostgresDb } from '../postgres/postgres-db.service'
import type { PrStatusStream } from '../pr-status-stream/pr-status-stream.service'
import type { S3 } from '../s3/s3.service'
import type {
	GitHubConnectionConflictError,
	GitHubConnectionNotFoundError,
	GitHubDisconnectFailedError,
	GitHubInstallationSuspendedError,
	GitHubIntegrationDisabledError,
	GitHubInstallStateInvalidError,
	GitHubIntegrationUnavailableError,
	GitHubIssueInputInvalidError,
	GitHubIssueNotFoundError,
	GitHubMissingPermissionsError,
	GitHubRepositoryAccessBlockedError,
	GitHubPullRequestMutationRejectedError,
	GitHubPullRequestNotFoundError,
	GitHubRepositoryNotAccessibleError,
	GitHubTaskNotFoundError,
	GitHubWebhookMalformedRequestError,
	GitHubWebhookSignatureInvalidError,
} from './github.errors'
import type { GitHubIssuePreview } from './github.issue-import'
import type { GitHubCapabilities } from './github.permissions'
import type { GitHubInstallationPermissions, GitHubRepository, GitHubTextTicketArtifactBundle } from './github.schema'
import type { GitHubWebhookEvent } from './github.webhooks'
import type { FetchedPullRequest } from './pull-requests/github-api'

export interface GitHubConnection {
	readonly id: string
	readonly accountId: string
	readonly accountLogin: string
	readonly accountType: 'Organization' | 'User'
	readonly repositorySelection: 'all' | 'selected'
	readonly repositoryCount: number
	readonly permissions: GitHubInstallationPermissions
	readonly status: 'active' | 'suspended'
	readonly needsReauth: boolean
	readonly suspendedAt: number | null
	readonly suspendedByLogin: string | null
	readonly managementUrl: string
	readonly capabilities: GitHubCapabilities
	readonly lastReconciledAt: number
}

export interface GitHubConnections {
	readonly enabled: boolean
	readonly connections: ReadonlyArray<GitHubConnection>
}

export interface GitHubInstallUrl {
	readonly url: string
	readonly expiresAt: number
}

export interface GitHubInstallationCompletion {
	readonly result: 'connected' | 'unclaimed'
	readonly connectionId?: string
}

export interface GitHubDisconnectResult {
	readonly success: true
}

type GitHubApiOperationServices = PostgresDb | HttpClient

export interface GitHubServiceShape {
	readonly createInstallUrl: (input: {
		readonly organizationId: string
		readonly requestedByUserId: string
		readonly repairConnectionId?: string
	}) => Effect.Effect<GitHubInstallUrl, GitHubConnectionNotFoundError | GitHubIntegrationUnavailableError, PostgresDb>
	readonly completeInstallation: (input: {
		readonly installationId: string
		readonly state?: string
	}) => Effect.Effect<
		GitHubInstallationCompletion,
		GitHubInstallStateInvalidError | GitHubConnectionConflictError | GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	readonly listConnections: (input: {
		readonly organizationId: string
	}) => Effect.Effect<GitHubConnections, GitHubIntegrationUnavailableError, PostgresDb>
	readonly getConnection: (input: {
		readonly organizationId: string
		readonly connectionId: string
	}) => Effect.Effect<GitHubConnection, GitHubConnectionNotFoundError | GitHubIntegrationUnavailableError, PostgresDb>
	readonly listRepositories: (input: {
		readonly organizationId: string
		readonly connectionId: string
	}) => Effect.Effect<
		ReadonlyArray<GitHubRepository>,
		GitHubConnectionNotFoundError | GitHubIntegrationUnavailableError,
		PostgresDb
	>
	readonly getIssuePreview: (input: {
		readonly organizationId: string
		readonly connectionId: string
		readonly repositoryId: string
		readonly issueInput: string
	}) => Effect.Effect<
		GitHubIssuePreview,
		| GitHubConnectionNotFoundError
		| GitHubRepositoryNotAccessibleError
		| GitHubIntegrationDisabledError
		| GitHubInstallationSuspendedError
		| GitHubMissingPermissionsError
		| GitHubIssueInputInvalidError
		| GitHubIssueNotFoundError
		| GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	readonly prepareIssueImport: (input: {
		readonly organizationId: string
		readonly taskId: string
		readonly importAttemptId: string
		readonly connectionId: string
		readonly repositoryId: string
		readonly issueInput: string
	}) => Effect.Effect<
		GitHubTextTicketArtifactBundle,
		| GitHubConnectionNotFoundError
		| GitHubRepositoryNotAccessibleError
		| GitHubIntegrationDisabledError
		| GitHubInstallationSuspendedError
		| GitHubMissingPermissionsError
		| GitHubIssueInputInvalidError
		| GitHubIssueNotFoundError
		| GitHubIntegrationUnavailableError,
		GitHubApiOperationServices | S3
	>
	readonly syncArtifactBacklink: (input: {
		readonly organizationId: string
		readonly userId: string
		readonly taskId: string
	}) => Effect.Effect<
		void,
		| GitHubTaskNotFoundError
		| GitHubConnectionNotFoundError
		| GitHubRepositoryNotAccessibleError
		| GitHubIntegrationDisabledError
		| GitHubInstallationSuspendedError
		| GitHubMissingPermissionsError
		| GitHubIssueInputInvalidError
		| GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	/**
	 * Reconciles one connection against GitHub's current authenticated state (installation
	 * metadata, permission grant, and repository inventory). Selects the connection by internal
	 * UUID under the authenticated organization; a suspended connection is guarded before any
	 * provider request.
	 */
	readonly refreshConnection: (input: {
		readonly organizationId: string
		readonly connectionId: string
	}) => Effect.Effect<
		GitHubConnection,
		GitHubConnectionNotFoundError | GitHubInstallationSuspendedError | GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	/**
	 * Item-level uninstall. Calls GitHub's app-authenticated installation deletion first and
	 * removes local state only after GitHub confirms the uninstall; a provider failure preserves
	 * local rows and returns a typed failure so the UI can offer a retry.
	 */
	readonly disconnect: (input: {
		readonly organizationId: string
		readonly connectionId: string
	}) => Effect.Effect<
		GitHubDisconnectResult,
		GitHubConnectionNotFoundError | GitHubDisconnectFailedError | GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	readonly fetchPullRequest: (input: {
		readonly organizationId: string
		readonly repoFullName: string
		readonly branch: string
	}) => Effect.Effect<
		FetchedPullRequest | null,
		| GitHubConnectionNotFoundError
		| GitHubRepositoryNotAccessibleError
		| GitHubRepositoryAccessBlockedError
		| GitHubMissingPermissionsError
		| GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	/**
	 * One write to a pull request as the App, guarded by the installation's grant before any
	 * provider call, then GitHub's current answer for the branch so the caller can record and
	 * publish the result of the write. Null when GitHub no longer reports a pull request there.
	 */
	readonly mutatePullRequest: (input: {
		readonly organizationId: string
		readonly repoFullName: string
		readonly branch: string
		readonly number: number
		readonly mutation: PullRequestMutation
	}) => Effect.Effect<
		FetchedPullRequest | null,
		| GitHubConnectionNotFoundError
		| GitHubRepositoryNotAccessibleError
		| GitHubMissingPermissionsError
		| GitHubRepositoryAccessBlockedError
		| GitHubPullRequestNotFoundError
		| GitHubPullRequestMutationRejectedError
		| GitHubIntegrationUnavailableError,
		GitHubApiOperationServices
	>
	/**
	 * Verifies `X-Hub-Signature-256` over the exact raw body and parses the supported event
	 * envelope. The webhook secret and crypto are encapsulated here; the route supplies only the
	 * raw body and headers and branches on the typed result.
	 */
	readonly verifyWebhook: (input: {
		readonly rawBody: string
		readonly headers: Headers
	}) => Effect.Effect<GitHubWebhookEvent, GitHubWebhookSignatureInvalidError | GitHubWebhookMalformedRequestError>
	/**
	 * Best-effort reconciliation of a verified webhook event. Structurally cannot fail
	 * (`never`) after a top-level `catchCause` logs and captures every failure or defect, so the
	 * route can fork it without ever risking the acknowledgement.
	 */
	readonly handleWebhook: (
		event: GitHubWebhookEvent,
	) => Effect.Effect<void, never, GitHubApiOperationServices | PrStatusStream>
}
