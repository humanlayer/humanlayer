import { createHash, randomBytes } from 'node:crypto'

import { githubIntegrationInstallStates } from '@humanlayer/db/tables/github-integration-install-states'
import { githubIntegrationRepositories } from '@humanlayer/db/tables/github-integration-repositories'
import {
	githubIntegrations,
	githubIntegrationSelectSchema,
	type GitHubIntegration,
} from '@humanlayer/db/tables/github-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { Sentry } from '../../../instrument'
import { PostgresDb, type PostgresTransaction } from '../postgres/postgres-db.service'
import {
	GitHubConnectionConflictError,
	GitHubConnectionNotFoundError,
	GitHubInstallStateInvalidError,
	GitHubIntegrationUnavailableError,
	GitHubRepositoryNotAccessibleError,
} from './github.errors'
import { deriveGitHubCapabilities } from './github.permissions'
import type { GitHubInstallation, GitHubInstallationToken, GitHubRepository } from './github.schema'
import type { GitHubConnection, GitHubConnections } from './github.types'

/** Installation statuses that own an organization binding and are shown as settings rows. */
const VISIBLE_CONNECTION_STATUSES = ['active', 'suspended'] as const

const INSTALL_STATE_LIFETIME_MILLIS = 7 * 24 * 60 * 60 * 1000

export interface GitHubInstallStateClaim {
	readonly id: string
	readonly organizationId: string
	readonly requestedByUserId: string
	readonly repairConnectionId?: string
	readonly consumed: boolean
}

const hashInstallState = (state: string): string => createHash('sha256').update(state).digest('hex')

const mapPersistenceError = (cause: unknown) => new GitHubIntegrationUnavailableError({ cause })

type SafePersistenceAttributes = Readonly<Record<string, string | number | boolean>>

const capturePersistenceFailure = (operation: string, cause: unknown, attributes: SafePersistenceAttributes = {}) =>
	Effect.logError('GitHub persistence operation failed', cause).pipe(
		Effect.annotateLogs({ operation, ...attributes }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(cause, {
					tags: { integration: 'github', operation },
					extra: attributes,
				}),
			),
		),
	)

const narrowPersistenceFailure =
	(operation: string, attributes: SafePersistenceAttributes = {}) =>
	(cause: unknown) =>
		capturePersistenceFailure(operation, cause, attributes).pipe(
			Effect.andThen(Effect.fail(mapPersistenceError(cause))),
		)

const failUnexpectedPersistenceState = (
	operation: string,
	cause: unknown,
	attributes: SafePersistenceAttributes = {},
) =>
	capturePersistenceFailure(operation, cause, attributes).pipe(
		Effect.andThen(Effect.fail(mapPersistenceError(cause))),
	)

const parseGitHubIntegrationRow = (
	row: unknown,
	operation: string,
	attributes: SafePersistenceAttributes = {},
): Effect.Effect<GitHubIntegration, GitHubIntegrationUnavailableError> => {
	const parsed = githubIntegrationSelectSchema.safeParse(row)
	return parsed.success
		? Effect.succeed(parsed.data)
		: capturePersistenceFailure(operation, parsed.error, attributes).pipe(
				Effect.andThen(Effect.fail(mapPersistenceError(parsed.error))),
			)
}

export const createGitHubInstallState = (input: {
	readonly organizationId: string
	readonly requestedByUserId: string
	readonly repairConnectionId?: string
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		if (input.repairConnectionId) {
			const [connection] = yield* postgres.query(
				postgres.client
					.select({ id: githubIntegrations.id })
					.from(githubIntegrations)
					.where(
						and(
							eq(githubIntegrations.id, input.repairConnectionId),
							eq(githubIntegrations.organization_id, input.organizationId),
						),
					)
					.limit(1),
			)
			if (!connection) {
				return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.repairConnectionId }))
			}
		}

		const state = randomBytes(32).toString('base64url')
		const expiresAt = now + INSTALL_STATE_LIFETIME_MILLIS
		yield* postgres.query(
			postgres.client.insert(githubIntegrationInstallStates).values({
				state_token_hash: hashInstallState(state),
				organization_id: input.organizationId,
				requested_by_user_id: input.requestedByUserId,
				repair_connection_id: input.repairConnectionId,
				expires_at: BigInt(expiresAt),
			}),
		)
		return { state, expiresAt }
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('create_install_state', { organization_id: input.organizationId }),
		),
		Effect.withSpan('github.persistence.create_install_state', {
			attributes: { organization_id: input.organizationId },
		}),
	)

export const validateGitHubInstallState = (
	state: string,
): Effect.Effect<
	GitHubInstallStateClaim,
	GitHubInstallStateInvalidError | GitHubIntegrationUnavailableError,
	PostgresDb
> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		const [row] = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrationInstallStates)
				.where(
					and(
						eq(githubIntegrationInstallStates.state_token_hash, hashInstallState(state)),
						gt(githubIntegrationInstallStates.expires_at, BigInt(now)),
					),
				)
				.limit(1),
		)
		if (!row) {
			return yield* Effect.fail(new GitHubInstallStateInvalidError({ reason: 'invalid_or_expired' }))
		}
		const claim = {
			id: row.id,
			organizationId: row.organization_id,
			requestedByUserId: row.requested_by_user_id,
			consumed: row.consumed_at !== null,
		}
		return row.repair_connection_id ? { ...claim, repairConnectionId: row.repair_connection_id } : claim
	}).pipe(
		Effect.catchTag('PostgresDbQueryError', narrowPersistenceFailure('validate_install_state')),
		Effect.withSpan('github.persistence.validate_install_state'),
	)

const replaceRepositories = (
	tx: PostgresTransaction,
	connectionId: string,
	repositories: ReadonlyArray<GitHubRepository>,
) =>
	Effect.gen(function* () {
		yield* tx.query(
			tx.client
				.delete(githubIntegrationRepositories)
				.where(eq(githubIntegrationRepositories.integration_id, connectionId)),
		)
		if (repositories.length > 0) {
			yield* tx.query(
				tx.client.insert(githubIntegrationRepositories).values(
					repositories.map((repository) => ({
						integration_id: connectionId,
						github_repository_id: repository.id,
						owner_login: repository.ownerLogin,
						repository_name: repository.name,
						full_name: repository.fullName,
						private: repository.private,
						default_branch: repository.defaultBranch,
						archived: repository.archived,
					})),
				),
			)
		}
	})

export const persistUnclaimedInstallation = (input: {
	readonly installation: GitHubInstallation
	readonly token: GitHubInstallationToken
	readonly repositories: ReadonlyArray<GitHubRepository>
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [existingRow] = yield* tx.query(
					tx.client
						.select()
						.from(githubIntegrations)
						.where(eq(githubIntegrations.installation_id, input.installation.id))
						.limit(1),
				)
				const existing = existingRow
					? yield* parseGitHubIntegrationRow(existingRow, 'persist_unclaimed_existing', {
							installation_id: input.installation.id,
						})
					: undefined
				if (existing?.installation_status === 'active') {
					return { id: existing.id, status: 'active' as const }
				}
				const [connectionRow] = yield* tx.query(
					tx.client
						.insert(githubIntegrations)
						.values({
							organization_id: null,
							installation_id: input.installation.id,
							account_id: input.installation.account.id,
							account_login: input.installation.account.login,
							account_type: input.installation.account.type,
							access_token: input.token.token,
							token_expires_at: BigInt(input.token.expiresAt),
							token_generation: 1,
							repository_selection: input.installation.repositorySelection,
							permissions: input.installation.permissions,
							installation_status: 'unclaimed',
							connected_by_user_id: null,
							last_reconciled_at: BigInt(now),
						})
						.onConflictDoUpdate({
							target: githubIntegrations.installation_id,
							set: {
								account_id: input.installation.account.id,
								account_login: input.installation.account.login,
								account_type: input.installation.account.type,
								access_token: input.token.token,
								token_expires_at: BigInt(input.token.expiresAt),
								repository_selection: input.installation.repositorySelection,
								permissions: input.installation.permissions,
								last_reconciled_at: BigInt(now),
								updated_at: BigInt(now),
							},
						})
						.returning(),
				)
				if (!connectionRow) {
					return yield* failUnexpectedPersistenceState(
						'persist_unclaimed_result',
						'unclaimed_insert_missing',
						{ installation_id: input.installation.id },
					)
				}
				const connection = yield* parseGitHubIntegrationRow(connectionRow, 'persist_unclaimed_result', {
					installation_id: input.installation.id,
				})
				yield* replaceRepositories(tx, connection.id, input.repositories)
				return { id: connection.id, status: 'unclaimed' as const }
			}),
		)
	}).pipe(
		Effect.catchTags({
			PostgresDbQueryError: narrowPersistenceFailure('persist_unclaimed_installation', {
				installation_id: input.installation.id,
			}),
			PostgresDbTransactionError: narrowPersistenceFailure('persist_unclaimed_installation', {
				installation_id: input.installation.id,
			}),
		}),
		Effect.withSpan('github.persistence.persist_unclaimed_installation', {
			attributes: { installation_id: input.installation.id },
		}),
	)

export const claimAndBindInstallation = (input: {
	readonly claim: GitHubInstallStateClaim
	readonly installation: GitHubInstallation
	readonly token: GitHubInstallationToken
	readonly repositories: ReadonlyArray<GitHubRepository>
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [state] = yield* tx.query(
					tx.client
						.select()
						.from(githubIntegrationInstallStates)
						.where(eq(githubIntegrationInstallStates.id, input.claim.id))
						.limit(1),
				)
				if (!state || state.expires_at <= BigInt(now)) {
					return yield* Effect.fail(new GitHubInstallStateInvalidError({ reason: 'invalid_or_expired' }))
				}

				const [existingByInstallationRow] = yield* tx.query(
					tx.client
						.select()
						.from(githubIntegrations)
						.where(eq(githubIntegrations.installation_id, input.installation.id))
						.limit(1),
				)
				const existingByInstallation = existingByInstallationRow
					? yield* parseGitHubIntegrationRow(existingByInstallationRow, 'claim_existing_installation', {
							organization_id: input.claim.organizationId,
							installation_id: input.installation.id,
						})
					: undefined
				if (
					existingByInstallation?.organization_id &&
					existingByInstallation.organization_id !== input.claim.organizationId
				) {
					return yield* Effect.fail(
						new GitHubConnectionConflictError({ installationId: input.installation.id }),
					)
				}
				if (state.consumed_at !== null) {
					if (existingByInstallation?.organization_id === input.claim.organizationId) {
						return existingByInstallation.id
					}
					return yield* Effect.fail(new GitHubInstallStateInvalidError({ reason: 'invalid_or_expired' }))
				}

				let targetConnection = existingByInstallation
				if (input.claim.repairConnectionId && !targetConnection) {
					const [repairConnectionRow] = yield* tx.query(
						tx.client
							.select()
							.from(githubIntegrations)
							.where(
								and(
									eq(githubIntegrations.id, input.claim.repairConnectionId),
									eq(githubIntegrations.organization_id, input.claim.organizationId),
								),
							)
							.limit(1),
					)
					if (!repairConnectionRow) {
						return yield* Effect.fail(
							new GitHubConnectionNotFoundError({ connectionId: input.claim.repairConnectionId }),
						)
					}
					const repairConnection = yield* parseGitHubIntegrationRow(
						repairConnectionRow,
						'claim_repair_connection',
						{
							organization_id: input.claim.organizationId,
							connection_id: input.claim.repairConnectionId,
						},
					)
					targetConnection = repairConnection
				}

				const values = {
					organization_id: input.claim.organizationId,
					installation_id: input.installation.id,
					account_id: input.installation.account.id,
					account_login: input.installation.account.login,
					account_type: input.installation.account.type,
					access_token: input.token.token,
					token_expires_at: BigInt(input.token.expiresAt),
					token_generation: (targetConnection?.token_generation ?? 0) + 1,
					repository_selection: input.installation.repositorySelection,
					permissions: input.installation.permissions,
					installation_status: 'active' as const,
					connected_by_user_id: input.claim.requestedByUserId,
					last_reconciled_at: BigInt(now),
					updated_at: BigInt(now),
				}
				const [connectionRow] = targetConnection
					? yield* tx.query(
							tx.client
								.update(githubIntegrations)
								.set(values)
								.where(eq(githubIntegrations.id, targetConnection.id))
								.returning(),
						)
					: yield* tx.query(tx.client.insert(githubIntegrations).values(values).returning())
				if (!connectionRow) {
					return yield* failUnexpectedPersistenceState('claim_bound_connection', 'connection_bind_missing', {
						organization_id: input.claim.organizationId,
						installation_id: input.installation.id,
					})
				}
				const connection = yield* parseGitHubIntegrationRow(connectionRow, 'claim_bound_connection', {
					organization_id: input.claim.organizationId,
					installation_id: input.installation.id,
				})

				const [consumed] = yield* tx.query(
					tx.client
						.update(githubIntegrationInstallStates)
						.set({ consumed_at: BigInt(now) })
						.where(
							and(
								eq(githubIntegrationInstallStates.id, input.claim.id),
								isNull(githubIntegrationInstallStates.consumed_at),
								gt(githubIntegrationInstallStates.expires_at, BigInt(now)),
							),
						)
						.returning({ id: githubIntegrationInstallStates.id }),
				)
				if (!consumed) {
					return yield* Effect.fail(new GitHubInstallStateInvalidError({ reason: 'invalid_or_expired' }))
				}
				yield* tx.query(
					tx.client
						.insert(organizationSettings)
						.values({ organization_id: input.claim.organizationId, github_integration_enabled: true })
						.onConflictDoUpdate({
							target: organizationSettings.organization_id,
							set: { github_integration_enabled: true, updated_at: BigInt(now) },
						}),
				)
				yield* replaceRepositories(tx, connection.id, input.repositories)
				return connection.id
			}),
		)
	}).pipe(
		Effect.catchTags({
			PostgresDbQueryError: narrowPersistenceFailure('claim_and_bind_installation', {
				organization_id: input.claim.organizationId,
				installation_id: input.installation.id,
			}),
			PostgresDbTransactionError: narrowPersistenceFailure('claim_and_bind_installation', {
				organization_id: input.claim.organizationId,
				installation_id: input.installation.id,
			}),
		}),
		Effect.withSpan('github.persistence.claim_and_bind_installation', {
			attributes: {
				organization_id: input.claim.organizationId,
				installation_id: input.installation.id,
			},
		}),
	)

/**
 * The GitHub installation-management page for the settings open/copy remediation action. It
 * always targets github.com (never the REST API origin) and is derived purely from the row.
 */
const buildManagementUrl = (row: GitHubIntegration): string =>
	row.account_type === 'Organization'
		? `https://github.com/organizations/${encodeURIComponent(row.account_login)}/settings/installations/${encodeURIComponent(row.installation_id)}`
		: `https://github.com/settings/installations/${encodeURIComponent(row.installation_id)}`

const projectConnection = (
	row: GitHubIntegration,
	repositoryCount: number,
): Effect.Effect<GitHubConnection, GitHubIntegrationUnavailableError> => {
	if (row.installation_status !== 'active' && row.installation_status !== 'suspended') {
		return failUnexpectedPersistenceState('project_connection', 'unclaimed_connection_projection', {
			connection_id: row.id,
		})
	}
	return Effect.succeed({
		id: row.id,
		accountId: row.account_id,
		accountLogin: row.account_login,
		accountType: row.account_type,
		repositorySelection: row.repository_selection,
		repositoryCount,
		permissions: row.permissions,
		status: row.installation_status,
		needsReauth: row.needs_reauth,
		suspendedAt: row.suspended_at !== null ? Number(row.suspended_at) : null,
		suspendedByLogin: row.suspended_by_login,
		managementUrl: buildManagementUrl(row),
		capabilities: deriveGitHubCapabilities(row.permissions),
		lastReconciledAt: Number(row.last_reconciled_at),
	})
}

const countRepositories = (connectionId: string) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const rows = yield* postgres.query(
			postgres.client
				.select({ id: githubIntegrationRepositories.id })
				.from(githubIntegrationRepositories)
				.where(eq(githubIntegrationRepositories.integration_id, connectionId)),
		)
		return rows.length
	})

/** What the status needs and nothing more: the switch and each visible installation's status. */
export interface GitHubStatusInput {
	readonly enabled: boolean
	readonly connections: ReadonlyArray<{ readonly status: GitHubConnection['status'] }>
}

export const readGitHubStatusInput = (
	organizationId: string,
): Effect.Effect<GitHubStatusInput, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [settings] = yield* postgres.query(
			postgres.client
				.select({ enabled: organizationSettings.github_integration_enabled })
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
				.limit(1),
		)
		const rows = yield* postgres.query(
			postgres.client
				.select({ status: githubIntegrations.installation_status })
				.from(githubIntegrations)
				.where(
					and(
						eq(githubIntegrations.organization_id, organizationId),
						inArray(githubIntegrations.installation_status, VISIBLE_CONNECTION_STATUSES),
					),
				),
		)
		return {
			enabled: settings?.enabled ?? false,
			connections: rows.map((row) => ({ status: row.status as GitHubConnection['status'] })),
		}
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('read_status_input', { organization_id: organizationId }),
		),
		Effect.withSpan('github.persistence.read_status_input', { attributes: { organization_id: organizationId } }),
	)

export const listGitHubConnections = (
	organizationId: string,
): Effect.Effect<GitHubConnections, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [settings] = yield* postgres.query(
			postgres.client
				.select({ enabled: organizationSettings.github_integration_enabled })
				.from(organizationSettings)
				.where(eq(organizationSettings.organization_id, organizationId))
				.limit(1),
		)
		const rows = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrations)
				.where(
					and(
						eq(githubIntegrations.organization_id, organizationId),
						inArray(githubIntegrations.installation_status, VISIBLE_CONNECTION_STATUSES),
					),
				),
		)
		const connections = yield* Effect.forEach(rows, (row) =>
			parseGitHubIntegrationRow(row, 'list_connections_row', { organization_id: organizationId }).pipe(
				Effect.flatMap((parsedRow) =>
					countRepositories(parsedRow.id).pipe(
						Effect.flatMap((count) => projectConnection(parsedRow, count)),
					),
				),
			),
		)
		return { enabled: settings?.enabled ?? false, connections }
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('list_connections', { organization_id: organizationId }),
		),
		Effect.withSpan('github.persistence.list_connections', { attributes: { organization_id: organizationId } }),
	)

export const getGitHubConnection = (input: { readonly organizationId: string; readonly connectionId: string }) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [row] = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrations)
				.where(
					and(
						eq(githubIntegrations.id, input.connectionId),
						eq(githubIntegrations.organization_id, input.organizationId),
						inArray(githubIntegrations.installation_status, VISIBLE_CONNECTION_STATUSES),
					),
				)
				.limit(1),
		)
		if (!row) return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.connectionId }))
		const parsedRow = yield* parseGitHubIntegrationRow(row, 'get_connection_row', {
			organization_id: input.organizationId,
			connection_id: input.connectionId,
		})
		const repositoryCount = yield* countRepositories(parsedRow.id)
		return yield* projectConnection(parsedRow, repositoryCount)
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('get_connection', {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
			}),
		),
		Effect.withSpan('github.persistence.get_connection', {
			attributes: { organization_id: input.organizationId, connection_id: input.connectionId },
		}),
	)

export const listGitHubRepositories = (input: { readonly organizationId: string; readonly connectionId: string }) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [connection] = yield* postgres.query(
			postgres.client
				.select({ id: githubIntegrations.id })
				.from(githubIntegrations)
				.where(
					and(
						eq(githubIntegrations.id, input.connectionId),
						eq(githubIntegrations.organization_id, input.organizationId),
						inArray(githubIntegrations.installation_status, VISIBLE_CONNECTION_STATUSES),
					),
				)
				.limit(1),
		)
		if (!connection) {
			return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.connectionId }))
		}
		const rows = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrationRepositories)
				.where(eq(githubIntegrationRepositories.integration_id, connection.id)),
		)
		return rows.map((row) => ({
			id: row.github_repository_id,
			ownerLogin: row.owner_login,
			name: row.repository_name,
			fullName: row.full_name,
			private: row.private,
			defaultBranch: row.default_branch,
			archived: row.archived,
		}))
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('list_repositories', {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
			}),
		),
		Effect.withSpan('github.persistence.list_repositories', {
			attributes: { organization_id: input.organizationId, connection_id: input.connectionId },
		}),
	)

export const loadGitHubTokenState = (input: { readonly organizationId: string; readonly connectionId: string }) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [row] = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrations)
				.where(
					and(
						eq(githubIntegrations.id, input.connectionId),
						eq(githubIntegrations.organization_id, input.organizationId),
					),
				)
				.limit(1),
		)
		if (!row) return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.connectionId }))
		return yield* parseGitHubIntegrationRow(row, 'load_token_state_row', {
			organization_id: input.organizationId,
			connection_id: input.connectionId,
		})
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('load_token_state', {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
			}),
		),
	)

export const persistRefreshedGitHubToken = (input: {
	readonly connectionId: string
	readonly observedGeneration: number
	readonly token: GitHubInstallationToken
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		const [updated] = yield* postgres.query(
			postgres.client
				.update(githubIntegrations)
				.set({
					access_token: input.token.token,
					token_expires_at: BigInt(input.token.expiresAt),
					token_generation: input.observedGeneration + 1,
					updated_at: BigInt(now),
				})
				.where(
					and(
						eq(githubIntegrations.id, input.connectionId),
						eq(githubIntegrations.token_generation, input.observedGeneration),
					),
				)
				.returning(),
		)
		if (updated) {
			return yield* parseGitHubIntegrationRow(updated, 'persist_refreshed_token_result', {
				connection_id: input.connectionId,
			})
		}
		const [current] = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrations)
				.where(eq(githubIntegrations.id, input.connectionId))
				.limit(1),
		)
		if (!current) {
			return yield* Effect.fail(new GitHubConnectionNotFoundError({ connectionId: input.connectionId }))
		}
		return yield* parseGitHubIntegrationRow(current, 'persist_refreshed_token_current', {
			connection_id: input.connectionId,
		})
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('persist_refreshed_token', { connection_id: input.connectionId }),
		),
	)

/**
 * Loads the integration row for an installation ID (webhook correlation). Returns `null` when
 * no connection exists — a delayed non-deletion delivery cannot recreate deleted state.
 */
export const findGitHubConnectionByInstallationId = (
	installationId: string,
): Effect.Effect<GitHubIntegration | null, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [row] = yield* postgres.query(
			postgres.client
				.select()
				.from(githubIntegrations)
				.where(eq(githubIntegrations.installation_id, installationId))
				.limit(1),
		)
		if (!row) return null
		return yield* parseGitHubIntegrationRow(row, 'find_by_installation_id', { installation_id: installationId })
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('find_by_installation_id', { installation_id: installationId }),
		),
		Effect.withSpan('github.persistence.find_by_installation_id', {
			attributes: { installation_id: installationId },
		}),
	)

/**
 * Atomically replaces the persisted installation metadata, token, and repository inventory
 * with GitHub's current authenticated state. The claim state is preserved (an org-bound
 * connection stays `active`; an unbound one stays `unclaimed`) and any suspension is cleared,
 * so `created`, `unsuspend`, `new_permissions_accepted`, and `installation_repositories`
 * deliveries all converge on GitHub's current state rather than replaying payload deltas.
 */
export const reconcileGitHubInstallationState = (input: {
	readonly installation: GitHubInstallation
	readonly token: GitHubInstallationToken
	readonly repositories: ReadonlyArray<GitHubRepository>
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [existingRow] = yield* tx.query(
					tx.client
						.select()
						.from(githubIntegrations)
						.where(eq(githubIntegrations.installation_id, input.installation.id))
						.limit(1),
				)
				const existing = existingRow
					? yield* parseGitHubIntegrationRow(existingRow, 'reconcile_existing', {
							installation_id: input.installation.id,
						})
					: undefined
				const commonValues = {
					account_id: input.installation.account.id,
					account_login: input.installation.account.login,
					account_type: input.installation.account.type,
					access_token: input.token.token,
					token_expires_at: BigInt(input.token.expiresAt),
					repository_selection: input.installation.repositorySelection,
					permissions: input.installation.permissions,
					last_reconciled_at: BigInt(now),
					updated_at: BigInt(now),
				}
				const [connectionRow] = existing
					? yield* tx.query(
							tx.client
								.update(githubIntegrations)
								.set({
									...commonValues,
									// An org-bound connection returns to active; an unclaimed one stays unclaimed.
									installation_status: existing.organization_id
										? ('active' as const)
										: ('unclaimed' as const),
									suspended_at: null,
									suspended_by_id: null,
									suspended_by_login: null,
									token_generation: existing.token_generation + 1,
								})
								.where(eq(githubIntegrations.id, existing.id))
								.returning(),
						)
					: yield* tx.query(
							tx.client
								.insert(githubIntegrations)
								.values({
									organization_id: null,
									installation_id: input.installation.id,
									...commonValues,
									token_generation: 1,
									installation_status: 'unclaimed' as const,
									connected_by_user_id: null,
								})
								.returning(),
						)
				if (!connectionRow) {
					return yield* failUnexpectedPersistenceState('reconcile_result', 'reconcile_row_missing', {
						installation_id: input.installation.id,
					})
				}
				const connection = yield* parseGitHubIntegrationRow(connectionRow, 'reconcile_result', {
					installation_id: input.installation.id,
				})
				yield* replaceRepositories(tx, connection.id, input.repositories)
				return {
					id: connection.id,
					status: connection.installation_status,
					organizationId: connection.organization_id,
				}
			}),
		)
	}).pipe(
		Effect.catchTags({
			PostgresDbQueryError: narrowPersistenceFailure('reconcile_installation_state', {
				installation_id: input.installation.id,
			}),
			PostgresDbTransactionError: narrowPersistenceFailure('reconcile_installation_state', {
				installation_id: input.installation.id,
			}),
		}),
		Effect.withSpan('github.persistence.reconcile_installation_state', {
			attributes: { installation_id: input.installation.id },
		}),
	)

/**
 * Records a verified suspension directly from the authenticated webhook payload: sets the
 * lifecycle to `suspended` and stores the actor/time while retaining the binding, token, and
 * repository inventory. GitHub blocks token minting for a suspended installation, so this is a
 * pure database transition with no provider call. A no-op (`found: false`) when no connection
 * exists keeps replayed deliveries idempotent.
 */
export const recordGitHubInstallationSuspension = (input: {
	readonly installationId: string
	readonly suspendedAt: number | null
	readonly suspendedById: string | null
	readonly suspendedByLogin: string | null
}): Effect.Effect<{ readonly found: boolean }, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		const [updated] = yield* postgres.query(
			postgres.client
				.update(githubIntegrations)
				.set({
					installation_status: 'suspended' as const,
					suspended_at: input.suspendedAt !== null ? BigInt(input.suspendedAt) : null,
					suspended_by_id: input.suspendedById,
					suspended_by_login: input.suspendedByLogin,
					last_reconciled_at: BigInt(now),
					updated_at: BigInt(now),
				})
				.where(eq(githubIntegrations.installation_id, input.installationId))
				.returning({ id: githubIntegrations.id }),
		)
		return { found: Boolean(updated) }
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('record_installation_suspension', { installation_id: input.installationId }),
		),
		Effect.withSpan('github.persistence.record_installation_suspension', {
			attributes: { installation_id: input.installationId },
		}),
	)

/**
 * Disables the organization's GitHub integration setting only when no connections remain for
 * it. Runs inside a caller-owned transaction so the connection deletion and the setting flip
 * are atomic. Repository inventory is removed by the `ON DELETE CASCADE` FK.
 */
const disableGitHubIntegrationWhenNoConnections = (tx: PostgresTransaction, organizationId: string, now: number) =>
	Effect.gen(function* () {
		const remaining = yield* tx.query(
			tx.client
				.select({ id: githubIntegrations.id })
				.from(githubIntegrations)
				.where(eq(githubIntegrations.organization_id, organizationId))
				.limit(1),
		)
		if (remaining.length === 0) {
			yield* tx.query(
				tx.client
					.update(organizationSettings)
					.set({ github_integration_enabled: false, updated_at: BigInt(now) })
					.where(eq(organizationSettings.organization_id, organizationId)),
			)
		}
	})

/**
 * Terminal cleanup for a verified `installation.deleted`: removes the matching connection and
 * its repository inventory without contacting GitHub, then disables the organization setting
 * only when no connections remain. Idempotent when no row exists (a replayed deletion).
 */
export const terminalDeleteGitHubInstallation = (
	installationId: string,
): Effect.Effect<{ readonly deleted: boolean }, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [deleted] = yield* tx.query(
					tx.client
						.delete(githubIntegrations)
						.where(eq(githubIntegrations.installation_id, installationId))
						.returning({
							id: githubIntegrations.id,
							organizationId: githubIntegrations.organization_id,
						}),
				)
				if (!deleted) return { deleted: false as const }
				if (deleted.organizationId) {
					yield* disableGitHubIntegrationWhenNoConnections(tx, deleted.organizationId, now)
				}
				return { deleted: true as const }
			}),
		)
	}).pipe(
		Effect.catchTags({
			PostgresDbQueryError: narrowPersistenceFailure('terminal_delete_installation', {
				installation_id: installationId,
			}),
			PostgresDbTransactionError: narrowPersistenceFailure('terminal_delete_installation', {
				installation_id: installationId,
			}),
		}),
		Effect.withSpan('github.persistence.terminal_delete_installation', {
			attributes: { installation_id: installationId },
		}),
	)

/**
 * Removes one connection (and its inventory) after GitHub has confirmed the uninstall, scoped
 * to the authenticated organization, then disables the organization setting only when no
 * connections remain. Returns `deleted: false` when the connection was already gone.
 */
export const deleteGitHubConnectionAfterConfirm = (input: {
	readonly organizationId: string
	readonly connectionId: string
}): Effect.Effect<{ readonly deleted: boolean }, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = yield* Clock.currentTimeMillis
		return yield* postgres.transaction((tx) =>
			Effect.gen(function* () {
				const [deleted] = yield* tx.query(
					tx.client
						.delete(githubIntegrations)
						.where(
							and(
								eq(githubIntegrations.id, input.connectionId),
								eq(githubIntegrations.organization_id, input.organizationId),
							),
						)
						.returning({ id: githubIntegrations.id }),
				)
				if (!deleted) return { deleted: false as const }
				yield* disableGitHubIntegrationWhenNoConnections(tx, input.organizationId, now)
				return { deleted: true as const }
			}),
		)
	}).pipe(
		Effect.catchTags({
			PostgresDbQueryError: narrowPersistenceFailure('delete_connection_after_confirm', {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
			}),
			PostgresDbTransactionError: narrowPersistenceFailure('delete_connection_after_confirm', {
				organization_id: input.organizationId,
				connection_id: input.connectionId,
			}),
		}),
		Effect.withSpan('github.persistence.delete_connection_after_confirm', {
			attributes: { organization_id: input.organizationId, connection_id: input.connectionId },
		}),
	)

export interface RepositoriesLinkedThroughGithubApp {
	/** As the installation reports it, so the caller shows GitHub's own spelling. */
	readonly fullName: string
	readonly defaultBranch: string
}

/**
 * Of the named repositories, the ones the org's active GitHub App installation can reach, with
 * each one's default branch, keyed by lowercased full name. A name absent from the result is one
 * the installation does not grant, or grants through an installation that is no longer active.
 */
export const findActiveInstallationRepositories = (input: {
	readonly organizationId: string
	readonly repoFullNames: readonly string[]
}): Effect.Effect<
	ReadonlyMap<string, RepositoriesLinkedThroughGithubApp>,
	GitHubIntegrationUnavailableError,
	PostgresDb
> =>
	Effect.gen(function* () {
		if (input.repoFullNames.length === 0) return new Map<string, RepositoriesLinkedThroughGithubApp>()
		const postgres = yield* PostgresDb
		const rows = yield* postgres.query(
			postgres.client
				.select({
					fullName: githubIntegrationRepositories.full_name,
					defaultBranch: githubIntegrationRepositories.default_branch,
				})
				.from(githubIntegrations)
				.innerJoin(
					githubIntegrationRepositories,
					eq(githubIntegrationRepositories.integration_id, githubIntegrations.id),
				)
				.where(
					and(
						eq(githubIntegrations.organization_id, input.organizationId),
						eq(githubIntegrations.installation_status, 'active'),
						inArray(
							sql`lower(${githubIntegrationRepositories.full_name})`,
							input.repoFullNames.map((name) => name.toLowerCase()),
						),
					),
				),
		)
		return new Map(rows.map((row) => [row.fullName.toLowerCase(), row]))
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('find_active_installation_repositories', {
				organization_id: input.organizationId,
			}),
		),
		Effect.withSpan('github.persistence.find_active_installation_repositories', {
			attributes: { organization_id: input.organizationId, repository_count: input.repoFullNames.length },
		}),
	)

export const findConnectionForRepository = (input: {
	readonly organizationId: string
	readonly repoFullName: string
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [row] = yield* postgres.query(
			postgres.client
				.select({ integration: githubIntegrations })
				.from(githubIntegrations)
				.innerJoin(
					githubIntegrationRepositories,
					eq(githubIntegrationRepositories.integration_id, githubIntegrations.id),
				)
				.where(
					and(
						eq(githubIntegrations.organization_id, input.organizationId),
						eq(githubIntegrations.installation_status, 'active'),
						sql`lower(${githubIntegrationRepositories.full_name}) = ${input.repoFullName.toLowerCase()}`,
					),
				)
				.limit(1),
		)
		if (!row) {
			return yield* Effect.fail(new GitHubRepositoryNotAccessibleError({ repositoryId: input.repoFullName }))
		}
		return yield* parseGitHubIntegrationRow(row.integration, 'find_connection_for_repository', {
			organization_id: input.organizationId,
		})
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('find_connection_for_repository', { organization_id: input.organizationId }),
		),
		Effect.withSpan('github.persistence.find_connection_for_repository', {
			attributes: { organization_id: input.organizationId },
		}),
	)

/** Whether the org has the GitHub App installed on at least one repository it still tracks. */
export const hasActiveInstalledRepository = (input: {
	readonly organizationId: string
}): Effect.Effect<boolean, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [installed] = yield* postgres.query(
			postgres.client
				.select({ id: githubIntegrationRepositories.id })
				.from(githubIntegrations)
				.innerJoin(
					githubIntegrationRepositories,
					eq(githubIntegrationRepositories.integration_id, githubIntegrations.id),
				)
				.where(
					and(
						eq(githubIntegrations.organization_id, input.organizationId),
						eq(githubIntegrations.installation_status, 'active'),
						eq(githubIntegrationRepositories.archived, false),
					),
				)
				.limit(1),
		)
		return installed !== undefined
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			narrowPersistenceFailure('has_active_installed_repository', { organization_id: input.organizationId }),
		),
		Effect.withSpan('github.persistence.has_active_installed_repository', {
			attributes: { organization_id: input.organizationId },
		}),
	)
