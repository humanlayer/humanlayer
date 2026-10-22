import { contextShards } from '@humanlayer/db/tables/context-shards'
import { userShardPreferences } from '@humanlayer/db/tables/user-shard-preferences'
import { and, asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase } from '../../effect-base'

/**
 * List the context shards enabled by the daemon's authenticated user.
 *
 * Organization and user identity are bound from the daemon token, never from
 * input. The inner join returns only shards with an `enabled` preference row
 * for that user, and the release/admin-dismissal guards are repeated so an
 * unreleased or dismissed shard can never reach an agent launch. Results use
 * stable shard-id order and are capped at 100.
 */
export const daemonListEnabledContextShardsProcedure = effectOrpcDaemonBase.contextShards.listEnabled.effect(
	function* ({ context, errors }) {
		const postgres = yield* PostgresDb
		const { organizationId, userId } = context.auth

		const rows = yield* postgres
			.query(
				postgres.client
					.select({ id: contextShards.id, shardText: contextShards.shard_text })
					.from(contextShards)
					.innerJoin(
						userShardPreferences,
						and(
							eq(userShardPreferences.shard_id, contextShards.id),
							eq(userShardPreferences.organization_id, contextShards.organization_id),
							eq(userShardPreferences.user_id, userId),
							eq(userShardPreferences.shard_state, 'enabled'),
						),
					)
					.where(
						and(
							eq(contextShards.organization_id, organizationId),
							eq(contextShards.released_to_org, true),
							eq(contextShards.dismissed, false),
						),
					)
					.orderBy(asc(contextShards.id))
					.limit(100),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo('Enabled context shards listed').pipe(
						Effect.annotateLogs({ organizationId, userId, count: result.length }),
					),
				),
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { data: rows }
	},
)
