import { codelayerAgentStateSnapshots } from '@humanlayer/db/tables/codelayer-agent-state-snapshots'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase } from '../../effect-base'

/**
 * Get a codelayer agent state snapshot by session_id and run_index.
 *
 * Authorization:
 * - Daemon must be authenticated (effectOrpcDaemonBase middleware handles this)
 * - Returns null if no (non-tombstoned, populated) snapshot exists for the given session/run
 */
export const getCodelayerStateSnapshotEffectProcedure = effectOrpcDaemonBase.codelayerState.snapshot.get.effect(
	function* ({ input, errors }) {
		// services
		const postgres = yield* PostgresDb

		// impl
		const state = yield* postgres
			.query(
				postgres.client
					.select({ state: codelayerAgentStateSnapshots.state })
					.from(codelayerAgentStateSnapshots)
					.where(
						and(
							eq(codelayerAgentStateSnapshots.session_id, input.sessionId),
							eq(codelayerAgentStateSnapshots.run_index, input.runIndex),
							isNotNull(codelayerAgentStateSnapshots.state),
							isNull(codelayerAgentStateSnapshots.tombstoned_at),
						),
					)
					.limit(1),
			)
			.pipe(
				Effect.map(([row]) => (row?.state ?? null) as Record<string, unknown> | null),
				Effect.tap((state) =>
					Effect.logInfo('Codelayer agent state snapshot fetched').pipe(
						Effect.annotateLogs({
							sessionId: input.sessionId,
							runIndex: input.runIndex,
							found: state !== null,
						}),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return state
	},
)
