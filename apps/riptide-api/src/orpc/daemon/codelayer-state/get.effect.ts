import { codelayerAgentState } from '@humanlayer/db/tables/codelayer-agent-state'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase } from '../../effect-base'

/**
 * Get codelayer agent state by session_id.
 *
 * Authorization:
 * - Daemon must be authenticated (effectOrpcDaemonBase middleware handles this)
 * - Returns null if no state exists for the given session
 */
export const getCodelayerStateEffectProcedure = effectOrpcDaemonBase.codelayerState.get.effect(function* ({
	input,
	errors,
}) {
	// services
	const postgres = yield* PostgresDb

	// impl
	const state = yield* postgres
		.query(
			postgres.client
				.select({ state: codelayerAgentState.state })
				.from(codelayerAgentState)
				.where(eq(codelayerAgentState.session_id, input.sessionId))
				.limit(1),
		)
		.pipe(
			Effect.map(([row]) => (row?.state ?? null) as Record<string, unknown> | null),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	yield* Effect.logInfo('Codelayer agent state fetched').pipe(
		Effect.annotateLogs({ sessionId: input.sessionId, found: state !== null }),
	)

	return state
})
