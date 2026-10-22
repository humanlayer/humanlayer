import { contextShards } from '@humanlayer/db/tables/context-shards'
import { type UserShardState, userShardPreferences } from '@humanlayer/db/tables/user-shard-preferences'
import { and, eq, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

/**
 * Verify the shard is a released, non-admin-dismissed shard in the caller's
 * organization, then upsert the caller's sparse preference row.
 *
 * Returns false when the shard is not visible to the caller (missing, in
 * another organization, unreleased, or admin-dismissed).
 */
export const upsertUserShardPreference = Effect.fn('contextShards.upsertUserPreference')(function* (params: {
	organizationId: string
	userId: string
	shardId: string
	shardState: UserShardState
}) {
	const { organizationId, userId, shardId, shardState } = params
	const postgres = yield* PostgresDb

	const [shard] = yield* postgres.query(
		postgres.client
			.select({ id: contextShards.id })
			.from(contextShards)
			.where(
				and(
					eq(contextShards.id, shardId),
					eq(contextShards.organization_id, organizationId),
					eq(contextShards.released_to_org, true),
					eq(contextShards.dismissed, false),
				),
			)
			.limit(1),
	)

	if (!shard) return false

	yield* postgres.query(
		postgres.client
			.insert(userShardPreferences)
			.values({
				organization_id: organizationId,
				user_id: userId,
				shard_id: shardId,
				shard_state: shardState,
			})
			.onConflictDoUpdate({
				target: [
					userShardPreferences.organization_id,
					userShardPreferences.user_id,
					userShardPreferences.shard_id,
				],
				set: {
					shard_state: shardState,
					updated_at: sql`${BigInt(yield* Clock.currentTimeMillis)}`,
				},
			}),
	)

	return true
})

/**
 * Set the authenticated user's personal state for one released shard.
 *
 * Sparse upsert: the first write inserts the preference row; later writes
 * update the same row. Never touches shared shard content or another user's
 * preference.
 */
export const updateContextShardPreferenceProcedure = effectOrpcBaseOrganizationRequired.contextShards.updatePreference
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const { shardId, shardState } = input
		const { organizationId, userId } = context.auth

		const updated = yield* upsertUserShardPreference({ organizationId, userId, shardId, shardState }).pipe(
			Effect.tapError((error) => Effect.logError('Failed to update context shard preference', error)),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTag('PostgresDbQueryError', (error) => mapPostgresErrorToResponse(error, errors)),
		)
		if (!updated) return yield* Effect.fail(errors.NOT_FOUND())

		yield* Effect.logInfo('Context shard preference updated').pipe(
			Effect.annotateLogs({ organizationId, userId, shardId, shardState }),
		)
		return { shardId, shardState }
	})
