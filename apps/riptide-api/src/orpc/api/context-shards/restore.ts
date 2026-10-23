import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'
import { upsertUserShardPreference } from './update-preference'

/**
 * Restore a user-dismissed shard for the authenticated user.
 *
 * Upserts the preference to `disabled`, so the shard returns to the active
 * list with Always-on off and does not affect sessions until re-enabled.
 */
export const restoreContextShardProcedure = effectOrpcBaseOrganizationRequired.contextShards.restore
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const { shardId } = input
		const { organizationId, userId } = context.auth

		const restored = yield* upsertUserShardPreference({
			organizationId,
			userId,
			shardId,
			shardState: 'disabled',
		}).pipe(
			Effect.tapError((error) => Effect.logError('Failed to restore context shard', error)),
			Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
			Effect.catchTag('PostgresDbQueryError', (error) => mapPostgresErrorToResponse(error, errors)),
		)
		if (!restored) return yield* Effect.fail(errors.NOT_FOUND())

		yield* Effect.logInfo('Context shard restored').pipe(Effect.annotateLogs({ organizationId, userId, shardId }))
		return { shardId, shardState: 'disabled' as const }
	})
