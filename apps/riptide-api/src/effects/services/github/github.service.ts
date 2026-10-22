import type { PrStatusKey } from '@humanlayer/streams/pr-status'
import { Config, Context, Data, Duration, Effect, type Fiber, Layer, Redacted } from 'effect'
import type { HttpClient } from 'effect/http/HttpClient'
import { importPKCS8 } from 'jose'

import { Sentry } from '../../../instrument'
import type { PostgresDb } from '../postgres/postgres-db.service'
import { PrStatusStream } from '../pr-status-stream/pr-status-stream.service'
import { getOrRefreshGitHubInstallationToken, signGitHubAppJwt } from './github.auth'
import { syncGitHubArtifactBacklink } from './github.backlink'
import {
	GitHubDisconnectFailedError,
	GitHubInstallationSuspendedError,
	GitHubIntegrationUnavailableError,
	GitHubMissingPermissionsError,
	type GitHubProviderAccessBlockedError,
	type GitHubProviderError,
	type GitHubProviderForbiddenError,
	GitHubRepositoryAccessBlockedError,
	GitHubWebhookSignatureInvalidError,
} from './github.errors'
import { completeGitHubInstallation, reconcileInstallation } from './github.installation'
import { getGitHubIssuePreview, prepareGitHubIssueImport } from './github.issue-import'
import { checkGitHubCapabilities, missingPermissionNames, refusedGitHubCapabilities } from './github.permissions'
import {
	createGitHubInstallState,
	deleteGitHubConnectionAfterConfirm,
	findConnectionForRepository,
	findGitHubConnectionByInstallationId,
	getGitHubConnection,
	listGitHubConnections,
	listGitHubRepositories,
	loadGitHubTokenState,
	recordGitHubInstallationSuspension,
	terminalDeleteGitHubInstallation,
} from './github.persistence'
import type { GitHubServiceShape } from './github.types'
import {
	computeGitHubSignature,
	type GitHubPrChangedWebhookEvent,
	type GitHubPrChecksChangedWebhookEvent,
	parseGitHubWebhookEvent,
	safeSignatureEqual,
	webhookLogFields,
} from './github.webhooks'
import { deleteInstallation } from './procedures/delete-installation'
import { fetchPullRequest } from './procedures/fetch-pull-request'
import { headCommitSessionId, PULL_REQUEST_PANEL_CAPABILITIES, toPullRequestRow } from './pull-requests/github-api'
import { mutatePullRequest } from './pull-requests/mutation'
import { findPullRequestsForBranches, recordPullRequest, selectPullRequestForBranch } from './pull-requests/persistence'

/**
 * The `pull_request` actions after which only the panel query can say how the pull request
 * merges: a push resets GitHub's merge state, and arming or disarming auto-merge on GitHub is
 * not in the delivery's row.
 */
const MERGE_STATE_REFRESH_ACTIONS: ReadonlySet<string> = new Set([
	'synchronize',
	'auto_merge_enabled',
	'auto_merge_disabled',
])

/** Long enough for GitHub to have settled its merge state after the event that scheduled it. */
const DEFAULT_MERGE_STATE_REFRESH_DELAY_MS = 15_000

interface PullRequestBranchEvent {
	readonly installationId: string
	readonly repoFullName: string
	readonly branch: string
}

const branchEventKey = (event: PullRequestBranchEvent) =>
	`${event.installationId}:${event.repoFullName.toLowerCase()}:${event.branch}`

export class GitHubPrivateKeyImportError extends Data.TaggedError('GitHubPrivateKeyImportError')<{
	readonly configurationKey: 'GITHUB_APP_PRIVATE_KEY'
}> {}

export class GitHubService extends Context.Service<GitHubService, GitHubServiceShape>()('GitHubService') {}

const importGitHubAppPrivateKey = (privateKey: Redacted.Redacted<string>) =>
	Effect.tryPromise({
		try: () => importPKCS8(Redacted.value(privateKey), 'RS256'),
		catch: () =>
			new GitHubPrivateKeyImportError({
				configurationKey: 'GITHUB_APP_PRIVATE_KEY',
			}),
	})

/** Logs and captures a raw provider disconnect failure before it is narrowed for the caller. */
const captureDisconnectFailure = (error: GitHubProviderError, connectionId: string) =>
	Effect.logError('GitHub disconnect provider call failed', error).pipe(
		Effect.annotateLogs({ operation: 'disconnect', connection_id: connectionId }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(error, {
					tags: { integration: 'github', operation: 'disconnect' },
					extra: { connection_id: connectionId },
				}),
			),
		),
	)

const findActiveOrganizationByInstallation = (installationId: string) =>
	findGitHubConnectionByInstallationId(installationId).pipe(
		Effect.map((connection) =>
			connection && connection.organization_id !== null && connection.installation_status === 'active'
				? connection.organization_id
				: null,
		),
	)

const publishCheckRows = (event: GitHubPrChecksChangedWebhookEvent) =>
	Effect.gen(function* () {
		const stream = yield* PrStatusStream
		const organizationId = yield* findActiveOrganizationByInstallation(event.installationId)
		if (organizationId === null) return
		const key: PrStatusKey = { organizationId, repoFullName: event.repoFullName, branch: event.branch }
		yield* stream.publishChecks(key, event.checks)
	}).pipe(
		Effect.withSpan('github.publish_check_rows', {
			attributes: { repo_full_name: event.repoFullName, branch: event.branch, check_count: event.checks.length },
		}),
	)

/**
 * A check settles the merge state only where there is an open pull request to settle it for.
 * Every branch in a covered repository reports its checks, so without this a push to a branch
 * nobody opened anything from would still cost a query against the installation's hourly budget.
 */
const settlesAnOpenPullRequest = (event: GitHubPrChecksChangedWebhookEvent) =>
	Effect.gen(function* () {
		if (!event.checks.some((check) => check.status === 'COMPLETED')) return false
		const organizationId = yield* findActiveOrganizationByInstallation(event.installationId)
		if (organizationId === null) return false
		const key = { repoFullName: event.repoFullName, branch: event.branch }
		const records = yield* findPullRequestsForBranches({ organizationId, keys: [key] })
		return selectPullRequestForBranch(records, key)?.state === 'open'
	}).pipe(
		Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.succeed(false)),
		Effect.withSpan('github.settles_an_open_pull_request', {
			attributes: { repo_full_name: event.repoFullName, branch: event.branch },
		}),
	)

// A delivery lacks the review decision and may lack `mergeable`, so the stream gets the stored
// row, which keeps what earlier sources knew, rather than the delivery's own view.
const recordPullRequestDelivery = (event: GitHubPrChangedWebhookEvent) =>
	Effect.gen(function* () {
		const stream = yield* PrStatusStream
		const organizationId = yield* findActiveOrganizationByInstallation(event.installationId)
		if (organizationId === null) return null
		const recorded = yield* recordPullRequest({
			organizationId,
			repoFullName: event.repoFullName,
			row: event.pullRequest,
			source: 'webhook',
			author: event.author,
			timestamps: event.timestamps,
		})
		const key: PrStatusKey = { organizationId, repoFullName: event.repoFullName, branch: event.branch }
		yield* stream.publishPullRequest(key, recorded.panelRow)
		return recorded
	}).pipe(
		Effect.withSpan('github.record_pull_request_delivery', {
			attributes: { repo_full_name: event.repoFullName, branch: event.branch, number: event.pullRequest.number },
		}),
	)

export const GitHubServiceLive = Layer.effect(
	GitHubService,
	Effect.gen(function* () {
		const appId = yield* Config.String('GITHUB_APP_ID')
		const clientId = yield* Config.String('GITHUB_APP_CLIENT_ID')
		const appSlug = yield* Config.String('GITHUB_APP_SLUG')
		const apiBaseUrl = yield* Config.URL('GITHUB_API_BASE_URL').pipe(
			Config.withDefault(new URL('https://api.github.com')),
		)
		const privateKey = yield* Config.Redacted('GITHUB_APP_PRIVATE_KEY')
		const webhookSecret = yield* Config.Redacted('GITHUB_APP_WEBHOOK_SECRET')
		const cloudOrigin = yield* Config.URL('CLOUD_ORIGIN')
		const mergeStateRefreshDelay = yield* Config.Number('GITHUB_MERGE_STATE_REFRESH_DELAY_MS').pipe(
			Config.withDefault(DEFAULT_MERGE_STATE_REFRESH_DELAY_MS),
			Config.map(Duration.millis),
		)
		const signingKey = yield* importGitHubAppPrivateKey(privateKey)
		const scope = yield* Effect.scope
		const pendingRefreshes = new Map<string, Fiber.Fiber<void>>()

		void appId

		const fetchPanelPullRequest: GitHubServiceShape['fetchPullRequest'] = ({
			organizationId,
			repoFullName,
			branch,
		}) =>
			Effect.gen(function* () {
				const connection = yield* findConnectionForRepository({ organizationId, repoFullName })
				const missing = checkGitHubCapabilities(connection.permissions, PULL_REQUEST_PANEL_CAPABILITIES)
				if (missing.length > 0) {
					return yield* Effect.fail(
						new GitHubMissingPermissionsError({ missing, detectedBy: 'installation_grant' }),
					)
				}
				const installationToken = yield* getOrRefreshGitHubInstallationToken({
					organizationId,
					connectionId: connection.id,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				})
				const capturePanelFailure = (error: GitHubProviderError) =>
					Effect.logError('GitHub pull request provider operation failed', error).pipe(
						Effect.annotateLogs({
							operation: 'fetch_pull_request',
							repo_full_name: repoFullName,
							branch,
						}),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { integration: 'github', operation: 'fetch_pull_request' },
									extra: { repo_full_name: repoFullName, branch },
								}),
							),
						),
						Effect.andThen(Effect.fail(new GitHubIntegrationUnavailableError({ cause: error }))),
					)
				return yield* fetchPullRequest({
					apiBaseUrl,
					installationToken,
					repoFullName,
					branch,
				}).pipe(
					Effect.catchTags({
						GitHubProviderAccessBlockedError: (error: GitHubProviderAccessBlockedError) =>
							Effect.logWarning('GitHub blocked the App from the repository').pipe(
								Effect.annotateLogs({
									operation: 'fetch_pull_request',
									repo_full_name: repoFullName,
									branch,
									connection_id: connection.id,
									refusal_messages: error.messages,
								}),
								Effect.andThen(
									Effect.fail(
										new GitHubRepositoryAccessBlockedError({
											repoFullName,
											messages: error.messages,
										}),
									),
								),
							),
						// The connection answers for a grant it no longer holds. This is the panel's
						// permission state and the reader is prompted to refresh the connection, so it
						// is logged with the refused paths and not captured as a failure.
						GitHubProviderForbiddenError: (error: GitHubProviderForbiddenError) => {
							const refused = refusedGitHubCapabilities(
								connection.permissions,
								PULL_REQUEST_PANEL_CAPABILITIES,
							)
							return Effect.logWarning('GitHub refused pull request panel nodes').pipe(
								Effect.annotateLogs({
									operation: 'fetch_pull_request',
									repo_full_name: repoFullName,
									branch,
									connection_id: connection.id,
									refused_paths: error.paths.join(' | '),
									refusal_messages: error.messages,
									declared_permissions: missingPermissionNames(refused),
								}),
								Effect.andThen(
									Effect.fail(
										new GitHubMissingPermissionsError({
											missing: refused,
											detectedBy: 'github_refusal',
										}),
									),
								),
							)
						},
						GitHubProviderTransportError: capturePanelFailure,
						GitHubProviderResponseError: capturePanelFailure,
						GitHubProviderDecodeError: capturePanelFailure,
					}),
				)
			}).pipe(
				Effect.withSpan('github.fetch_pull_request', {
					attributes: {
						organization_id: organizationId,
						repo_full_name: repoFullName,
						branch,
					},
				}),
			)

		// One query, one point of the installation's hourly budget, for what only the query knows:
		// the review decision after a review, the merge state after a push or a check.
		const refreshPullRequest = (event: PullRequestBranchEvent) =>
			Effect.gen(function* () {
				const stream = yield* PrStatusStream
				const organizationId = yield* findActiveOrganizationByInstallation(event.installationId)
				if (organizationId === null) return
				const fetched = yield* fetchPanelPullRequest({
					organizationId,
					repoFullName: event.repoFullName,
					branch: event.branch,
				})
				if (fetched === null) return
				const recorded = yield* recordPullRequest({
					organizationId,
					repoFullName: event.repoFullName,
					row: toPullRequestRow({ repoFullName: event.repoFullName, branch: event.branch, ...fetched }),
					source: 'app',
					trailerSessionId: headCommitSessionId(fetched.wire),
				})
				const key: PrStatusKey = { organizationId, repoFullName: event.repoFullName, branch: event.branch }
				yield* stream.publishPullRequest(key, recorded.panelRow)
			}).pipe(
				// An installation without the Checks permission is a first-class state the panel
				// prompts for, not a failure: the delivery has nothing to refresh, so it stops here
				// rather than reaching the handler's Sentry capture on every review.
				Effect.catchTags({
					GitHubMissingPermissionsError: () => Effect.void,
					GitHubRepositoryAccessBlockedError: () => Effect.void,
				}),
				Effect.withSpan('github.refresh_pull_request', {
					attributes: { repo_full_name: event.repoFullName, branch: event.branch },
				}),
			)

		// A push is followed by a burst of check completions, and GitHub settles its merge state a
		// moment after each; one refresh a little after the first event covers the burst. The
		// fiber outlives the delivery that scheduled it, so it carries its own capture.
		const scheduleMergeStateRefresh = (event: PullRequestBranchEvent) =>
			Effect.gen(function* () {
				const id = branchEventKey(event)
				if (pendingRefreshes.has(id)) return
				const context = yield* Effect.context<PostgresDb | HttpClient | PrStatusStream>()
				const fiber = yield* Effect.forkIn(
					Effect.sleep(mergeStateRefreshDelay).pipe(
						Effect.andThen(refreshPullRequest(event)),
						Effect.catchCause((cause) =>
							Effect.logError('GitHub merge state refresh failed', cause).pipe(
								Effect.annotateLogs({ repo_full_name: event.repoFullName, branch: event.branch }),
								Effect.andThen(
									Effect.sync(() =>
										Sentry.captureException(cause, {
											tags: { integration: 'github', operation: 'merge_state_refresh' },
											extra: { repo_full_name: event.repoFullName, branch: event.branch },
										}),
									),
								),
								Effect.asVoid,
							),
						),
						Effect.ensuring(Effect.sync(() => pendingRefreshes.delete(id))),
						Effect.provideContext(context),
					),
					scope,
				)
				pendingRefreshes.set(id, fiber)
			})

		return GitHubService.of({
			createInstallUrl: ({ organizationId, requestedByUserId, repairConnectionId }) => {
				const installStateInput: {
					organizationId: string
					requestedByUserId: string
					repairConnectionId?: string
				} = {
					organizationId,
					requestedByUserId,
				}
				if (repairConnectionId) installStateInput.repairConnectionId = repairConnectionId
				return createGitHubInstallState(installStateInput).pipe(
					Effect.map(({ state, expiresAt }) => {
						const installUrl = new URL(
							`https://github.com/apps/${encodeURIComponent(appSlug)}/installations/new`,
						)
						installUrl.searchParams.set('state', state)
						return { url: installUrl.toString(), expiresAt }
					}),
					Effect.withSpan('github.create_install_url', {
						attributes: { organization_id: organizationId },
					}),
				)
			},
			completeInstallation: ({ installationId, state }) => {
				const completionInput: {
					installationId: string
					state?: string
					apiBaseUrl: URL
					issuer: string
					signingKey: CryptoKey
				} = {
					installationId,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				}
				if (state) completionInput.state = state
				return completeGitHubInstallation(completionInput)
			},
			listConnections: ({ organizationId }) =>
				listGitHubConnections(organizationId).pipe(
					Effect.withSpan('github.list_connections', { attributes: { organization_id: organizationId } }),
				),
			getConnection: ({ organizationId, connectionId }) =>
				getGitHubConnection({ organizationId, connectionId }).pipe(
					Effect.withSpan('github.get_connection', {
						attributes: { organization_id: organizationId, connection_id: connectionId },
					}),
				),
			listRepositories: ({ organizationId, connectionId }) =>
				listGitHubRepositories({ organizationId, connectionId }).pipe(
					Effect.withSpan('github.list_repositories', {
						attributes: { organization_id: organizationId, connection_id: connectionId },
					}),
				),
			getIssuePreview: ({ organizationId, connectionId, repositoryId, issueInput }) =>
				getGitHubIssuePreview({
					organizationId,
					connectionId,
					repositoryId,
					issueInput,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				}),
			prepareIssueImport: ({ organizationId, taskId, importAttemptId, connectionId, repositoryId, issueInput }) =>
				prepareGitHubIssueImport({
					organizationId,
					taskId,
					importAttemptId,
					connectionId,
					repositoryId,
					issueInput,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				}),
			syncArtifactBacklink: ({ organizationId, userId, taskId }) =>
				syncGitHubArtifactBacklink({
					organizationId,
					userId,
					taskId,
					cloudOrigin: cloudOrigin.origin,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				}),
			refreshConnection: ({ organizationId, connectionId }) =>
				Effect.gen(function* () {
					const connection = yield* loadGitHubTokenState({ organizationId, connectionId })
					// A suspended installation blocks refresh with zero provider requests: GitHub
					// cannot mint its token, and reconnecting does not fix a suspension.
					if (connection.installation_status === 'suspended') {
						return yield* Effect.fail(
							new GitHubInstallationSuspendedError({
								connectionId,
								suspendedAt: connection.suspended_at !== null ? Number(connection.suspended_at) : null,
								suspendedByLogin: connection.suspended_by_login,
							}),
						)
					}
					yield* reconcileInstallation({
						installationId: connection.installation_id,
						apiBaseUrl,
						issuer: clientId,
						signingKey,
					})
					return yield* getGitHubConnection({ organizationId, connectionId })
				}).pipe(
					Effect.withSpan('github.refresh_connection', {
						attributes: { organization_id: organizationId, connection_id: connectionId },
					}),
				),
			disconnect: ({ organizationId, connectionId }) =>
				Effect.gen(function* () {
					const connection = yield* loadGitHubTokenState({ organizationId, connectionId })
					const appJwt = yield* signGitHubAppJwt({ issuer: clientId, signingKey }).pipe(
						Effect.mapError((cause) => new GitHubIntegrationUnavailableError({ cause })),
					)
					// GitHub confirms the uninstall (204 deleted or 404 already gone) before any local
					// row is removed; a provider failure preserves local state for a retry.
					yield* deleteInstallation({
						apiBaseUrl,
						installationId: connection.installation_id,
						appJwt,
					}).pipe(
						Effect.tapError((error) => captureDisconnectFailure(error, connectionId)),
						Effect.mapError((cause) => new GitHubDisconnectFailedError({ connectionId, cause })),
					)
					yield* deleteGitHubConnectionAfterConfirm({ organizationId, connectionId })
					return { success: true as const }
				}).pipe(
					Effect.withSpan('github.disconnect', {
						attributes: { organization_id: organizationId, connection_id: connectionId },
					}),
				),
			fetchPullRequest: fetchPanelPullRequest,
			mutatePullRequest: ({ organizationId, repoFullName, branch, number, mutation }) =>
				mutatePullRequest({
					organizationId,
					repoFullName,
					branch,
					number,
					mutation,
					apiBaseUrl,
					issuer: clientId,
					signingKey,
				}),
			verifyWebhook: ({ rawBody, headers }) =>
				Effect.gen(function* () {
					const providedSignature = headers.get('X-Hub-Signature-256')
					const eventType = headers.get('X-GitHub-Event')
					const deliveryId = headers.get('X-GitHub-Delivery')
					if (!providedSignature) {
						return yield* Effect.fail(
							new GitHubWebhookSignatureInvalidError({ reason: 'missing_signature_header' }),
						)
					}
					const expectedSignature = computeGitHubSignature({
						webhookSecret: Redacted.value(webhookSecret),
						rawBody,
					})
					if (!safeSignatureEqual(expectedSignature, providedSignature)) {
						return yield* Effect.fail(
							new GitHubWebhookSignatureInvalidError({ reason: 'signature_mismatch' }),
						)
					}
					return yield* parseGitHubWebhookEvent({ rawBody, eventType, deliveryId })
				}).pipe(
					Effect.tap((event) => Effect.annotateCurrentSpan({ event_type: event.type })),
					Effect.withSpan('github.verify_webhook'),
				),
			handleWebhook: (event) =>
				Effect.gen(function* () {
					switch (event.type) {
						case 'reconcile':
							yield* reconcileInstallation({
								installationId: event.installationId,
								apiBaseUrl,
								issuer: clientId,
								signingKey,
							}).pipe(Effect.asVoid)
							return
						case 'suspend':
							yield* recordGitHubInstallationSuspension({
								installationId: event.installationId,
								suspendedAt: event.suspendedAt,
								suspendedById: event.suspendedById,
								suspendedByLogin: event.suspendedByLogin,
							}).pipe(Effect.asVoid)
							return
						case 'delete':
							yield* terminalDeleteGitHubInstallation(event.installationId).pipe(Effect.asVoid)
							return
						case 'pr_checks_changed':
							yield* publishCheckRows(event)
							if (yield* settlesAnOpenPullRequest(event)) yield* scheduleMergeStateRefresh(event)
							return
						case 'pr_changed': {
							const recorded = yield* recordPullRequestDelivery(event)
							const isOpen = event.pullRequest.state === 'open'
							// The delivery has no commit message, so only the panel query can read the
							// head commit's trailer for a pull request no session observed the branch of.
							const needsTrailer = event.action === 'opened' && recorded?.hasOwner === false
							if (isOpen && (MERGE_STATE_REFRESH_ACTIONS.has(event.action) || needsTrailer)) {
								yield* scheduleMergeStateRefresh(event)
							}
							return
						}
						case 'pr_reviewed':
							yield* refreshPullRequest(event)
							return
						case 'ignored':
							return
					}
				}).pipe(
					Effect.tap(() =>
						Effect.logInfo('GitHub webhook handled').pipe(Effect.annotateLogs(webhookLogFields(event))),
					),
					Effect.catchCause((cause) =>
						Effect.logError('GitHub webhook handling failed').pipe(
							Effect.annotateLogs(webhookLogFields(event)),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(cause, {
										tags: { integration: 'github', error_type: 'github_webhook_processing' },
										extra: webhookLogFields(event),
									}),
								),
							),
						),
					),
					Effect.withSpan('github.handle_webhook', { attributes: { event_type: event.type } }),
				),
		})
	}),
)
