import { onlineHosts, onlineHostUpdateState } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq, type SQL, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase } from '../../effect-base'

export const heartbeatEffectProcedure = effectOrpcDaemonBase.hosts.heartbeat.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb

	const {
		hostId,
		hostName,
		daemonVersion,
		reportsRepositories,
		capabilities,
		supportedModels,
		distribution,
		canSelfUpdate,
		ephemeral,
		update,
		machine,
		stats,
		codingAgentUsageLimits,
	} = input
	const { userId, organizationId, hostId: authHostId } = context.auth

	if (hostId !== authHostId) {
		return yield* Effect.fail(errors.FORBIDDEN())
	}

	const now = BigInt(Date.now())
	const reportsRepositoriesForOlderApps =
		reportsRepositories ?? (capabilities?.includes('reportsRepositories') ? true : null)

	// The requested update completed once the daemon reports the version that was asked for.
	const requestFulfilled = sql`${onlineHosts.update_requested_version} = ${daemonVersion ?? null}`
	const clearedWhenFulfilled = (otherwise: SQL) => sql`case when ${requestFulfilled} then null else ${otherwise} end`
	const updateStateColumnType = sql.raw(onlineHostUpdateState.enumName)

	const result = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				// Verify the organization exists
				const [org] = yield* tx.query(
					tx.client
						.select({ id: organizations.id })
						.from(organizations)
						.where(eq(organizations.id, organizationId)),
				)

				if (!org) {
					return yield* Effect.fail(errors.UNAUTHORIZED({ message: 'Organization not found' }))
				}

				// Upsert the host record
				const [host] = yield* tx.query(
					tx.client
						.insert(onlineHosts)
						.values({
							host_id: hostId,
							host_name: hostName,
							user_id: userId,
							organization_id: organizationId,
							status: 'online',
							last_seen: now,
							daemon_version: daemonVersion ?? null,
							reports_repositories: reportsRepositoriesForOlderApps,
							capabilities: capabilities ?? null,
							supported_models: supportedModels ?? null,
							distribution: distribution ?? null,
							can_self_update: canSelfUpdate ?? null,
							ephemeral: ephemeral ?? false,
							update_state: update?.state ?? null,
							update_error: update?.error ?? null,
							machine: machine ?? null,
							stats: stats ?? null,
							coding_agent_usage_limits: codingAgentUsageLimits ?? null,
						})
						.onConflictDoUpdate({
							target: [onlineHosts.host_id, onlineHosts.organization_id, onlineHosts.user_id],
							set: {
								host_name: hostName,
								status: 'online',
								last_seen: now,
								// Written back as null when the daemon stops sending them: a host that
								// downgraded has genuinely lost the capability.
								daemon_version: daemonVersion ?? null,
								reports_repositories: reportsRepositoriesForOlderApps,
								capabilities: capabilities ?? null,
								supported_models: supportedModels ?? null,
								distribution: distribution ?? null,
								can_self_update: canSelfUpdate ?? null,
								ephemeral: ephemeral ?? false,
								update_requested_version: sql`nullif(${onlineHosts.update_requested_version}, ${daemonVersion ?? null})`,
								update_state: clearedWhenFulfilled(
									update === undefined
										? sql`${onlineHosts.update_state}`
										: sql`${update.state}::${updateStateColumnType}`,
								),
								update_error: clearedWhenFulfilled(
									update === undefined
										? sql`${onlineHosts.update_error}`
										: sql`${update.error ?? null}::text`,
								),
								machine: machine ?? null,
								stats: stats ?? null,
								coding_agent_usage_limits: codingAgentUsageLimits ?? null,
							},
						})
						.returning({
							updateRequestedVersion: onlineHosts.update_requested_version,
							updateState: onlineHosts.update_state,
						}),
				)

				return {
					updateRequest:
						host !== undefined && host.updateState === 'requested' && host.updateRequestedVersion !== null
							? { version: host.updateRequestedVersion }
							: null,
				}
			}),
		)
		.pipe(
			Effect.tap(() =>
				Effect.logInfo('Host heartbeat processed').pipe(
					Effect.annotateLogs({ hostId, userId, organizationId }),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	return result
})
