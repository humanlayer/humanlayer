import { NO_STAGE_KEY } from '@humanlayer/riptide-api-contract/api/metrics/stageSpendTrend'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'
import { Context, Data, Effect, Layer, Schema } from 'effect'

import type { PostgresDbQueryError } from '../postgres/postgres-db.errors'
import { PostgresReadReplicaDb } from '../postgres/postgres-read-replica.service'
import { mostProgressedStageSql } from './stage-attribution'

/**
 * The window an Advanced Metrics cross-tab is computed over. Real epoch
 * milliseconds, already shifted into the caller's calendar by
 * `resolveMetricsRange` — this service does no timezone arithmetic of its own,
 * so every metrics endpoint keeps agreeing about where a day starts.
 */
export interface OrganizationSpendWindow {
	readonly organizationId: string
	readonly startTimestamp: bigint
	readonly endTimestamp: bigint
}

/** One person's spend inside one RPI workflow stage, over the whole window. */
export interface SpendByPersonAndStage {
	/** WorkOS user id ('user_…') that owned the usage. */
	readonly userId: string
	/** RPI label name ('rpi:implementation', …) or the `no_stage` sentinel. */
	readonly stage: string
	readonly costUsd: number
}

/** One person's spend inside one workflow mode, over the whole window. */
export interface SpendByPersonAndMode {
	/** WorkOS user id ('user_…') that owned the usage. */
	readonly userId: string
	/** `tasks.workflow_type`, or 'freeform' for task-less sessions. */
	readonly mode: string
	readonly costUsd: number
}

/**
 * The replica could not answer. `retryable` distinguishes a connection or
 * deadlock blip from a query that will fail again the same way, which is the
 * only thing a caller can act on.
 */
export class PersonSpendAnalyticsUnavailable extends Data.TaggedError('PersonSpendAnalyticsUnavailable')<{
	readonly retryable: boolean
}> {}

/**
 * The replica answered with rows this service cannot read. A schema change or a
 * driver-level type change lands here rather than being coerced into a chart.
 */
export class PersonSpendAnalyticsRowInvalid extends Data.TaggedError('PersonSpendAnalyticsRowInvalid')<{
	readonly operation: string
}> {}

export type PersonSpendAnalyticsError = PersonSpendAnalyticsUnavailable | PersonSpendAnalyticsRowInvalid

/**
 * `cost_usd` is `double precision`, so postgres-js hands back a JS number and
 * `SUM()` over it stays `double precision`. Decoded rather than coerced: a
 * `Number(row.cost_usd)` would turn a future column-type change into silent
 * `NaN` in a dollar figure, where this turns it into a 500 and a Sentry event.
 *
 * NULL survives decoding and is folded to 0 afterwards: a group only exists
 * because it has usage rows, so a NULL sum means every row in it carried no
 * cost, which is zero dollars rather than missing data.
 */
const SummedCostUsd = Schema.NullOr(Schema.Number)

const SpendByPersonAndStageRow = Schema.Struct({
	user_id: Schema.String,
	stage: Schema.String,
	cost_usd: SummedCostUsd,
})

const SpendByPersonAndModeRow = Schema.Struct({
	user_id: Schema.String,
	mode: Schema.String,
	cost_usd: SummedCostUsd,
})

/**
 * Capture-before-narrow for replica failures: the rich driver error reaches the
 * logs and Sentry, and only the two-outcome domain error leaves the service.
 * Without this the procedure edge would capture a flat 500 with no SQLSTATE.
 */
const captureThenReportUnavailable = (operation: string) => (error: PostgresDbQueryError) =>
	Effect.logError('Person spend analytics query failed', error).pipe(
		Effect.annotateLogs({ operation }),
		Effect.andThen(Effect.sync(() => Sentry.captureException(error, { tags: { operation } }))),
		Effect.andThen(Effect.fail(new PersonSpendAnalyticsUnavailable({ retryable: error.retryable }))),
	)

const decodeSpendRows = <S extends Schema.Top>(schema: S, operation: string, rows: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(schema))(rows).pipe(
		Effect.tapError((issue) =>
			Effect.logError('Person spend analytics row decode failed', issue).pipe(Effect.annotateLogs({ operation })),
		),
		Effect.tapError((issue) => Effect.sync(() => Sentry.captureException(issue, { tags: { operation } }))),
		Effect.mapError(() => new PersonSpendAnalyticsRowInvalid({ operation })),
	)

/**
 * Spend cross-tabbed by person and RPI stage.
 *
 * Stage resolution is the SHARED {@link mostProgressedStageSql}, not a second
 * copy, so summing this by stage reproduces `stageSpendTrend` exactly — the
 * invariant that lets the card roll up to the ranking above it.
 *
 * The label unnest runs once per session with usage in the window (the
 * `session_stage` CTE), not once per usage row. Served by the existing
 * (organization_id, occurred_at) index prefix — no new index.
 */
const summarizeSpendByPersonAndStage = Effect.fn('metrics.summarize_spend_by_person_and_stage')(function* (
	input: OrganizationSpendWindow,
) {
	const replica = yield* PostgresReadReplicaDb

	const rows = yield* replica
		.query(
			replica.client.execute(sql`
				WITH usage_rows AS (
					SELECT session_id, session_creator_user_id, cost_usd
					FROM session_usage_events
					WHERE organization_id = ${input.organizationId}
						AND occurred_at >= ${input.startTimestamp}
						AND occurred_at <= ${input.endTimestamp}
				),
				session_stage AS (
					SELECT s.id, ${mostProgressedStageSql()} AS stage
					FROM sessions s
					WHERE s.id IN (SELECT DISTINCT session_id FROM usage_rows)
				)
				SELECT
					u.session_creator_user_id AS user_id,
					COALESCE(ss.stage, ${NO_STAGE_KEY}) AS stage,
					SUM(u.cost_usd) AS cost_usd
				FROM usage_rows u
				JOIN session_stage ss ON ss.id = u.session_id
				GROUP BY 1, 2
			`),
		)
		.pipe(
			Effect.catchTag(
				'PostgresDbQueryError',
				captureThenReportUnavailable('metrics.summarize_spend_by_person_and_stage'),
			),
		)

	const decoded = yield* decodeSpendRows(
		SpendByPersonAndStageRow,
		'metrics.summarize_spend_by_person_and_stage',
		rows,
	)

	return decoded.map(
		(row): SpendByPersonAndStage => ({
			userId: row.user_id,
			stage: row.stage,
			costUsd: row.cost_usd ?? 0,
		}),
	)
})

/**
 * Spend cross-tabbed by person and workflow mode.
 *
 * The join goes through `sessions` rather than the denormalized
 * `session_usage_events.task_id`, so a session reassigned to another task
 * reports its CURRENT task's mode. That matches `modeSpendTrend`, which is what
 * lets the card roll up to the ranking above it.
 */
const summarizeSpendByPersonAndMode = Effect.fn('metrics.summarize_spend_by_person_and_mode')(function* (
	input: OrganizationSpendWindow,
) {
	const replica = yield* PostgresReadReplicaDb

	const rows = yield* replica
		.query(
			replica.client.execute(sql`
				SELECT
					sue.session_creator_user_id AS user_id,
					COALESCE(t.workflow_type, 'freeform') AS mode,
					SUM(sue.cost_usd) AS cost_usd
				FROM session_usage_events sue
				JOIN sessions s ON s.id = sue.session_id
				LEFT JOIN tasks t ON t.id = s.task_id
				WHERE sue.organization_id = ${input.organizationId}
					AND sue.occurred_at >= ${input.startTimestamp}
					AND sue.occurred_at <= ${input.endTimestamp}
				GROUP BY 1, 2
			`),
		)
		.pipe(
			Effect.catchTag(
				'PostgresDbQueryError',
				captureThenReportUnavailable('metrics.summarize_spend_by_person_and_mode'),
			),
		)

	const decoded = yield* decodeSpendRows(SpendByPersonAndModeRow, 'metrics.summarize_spend_by_person_and_mode', rows)

	return decoded.map(
		(row): SpendByPersonAndMode => ({
			userId: row.user_id,
			mode: row.mode,
			costUsd: row.cost_usd ?? 0,
		}),
	)
})

/**
 * The two-dimensional Advanced Metrics spend cross-tabs.
 *
 * Callers hand over an organization and a window and get domain records back.
 * Which pool answers, how a stage is resolved, how a reassigned session picks
 * its mode, and how a driver row becomes a number all stay in here — a caller
 * that had to know any of it could break the invariant that every split of the
 * Workflow tab totals the same dollars.
 */
export class PersonSpendAnalytics extends Context.Service<
	PersonSpendAnalytics,
	{
		readonly spendByPersonAndStage: (
			input: OrganizationSpendWindow,
		) => Effect.Effect<ReadonlyArray<SpendByPersonAndStage>, PersonSpendAnalyticsError, PostgresReadReplicaDb>
		readonly spendByPersonAndMode: (
			input: OrganizationSpendWindow,
		) => Effect.Effect<ReadonlyArray<SpendByPersonAndMode>, PersonSpendAnalyticsError, PostgresReadReplicaDb>
	}
>()('PersonSpendAnalytics') {}

export const PersonSpendAnalyticsLive = Layer.succeed(PersonSpendAnalytics, {
	spendByPersonAndStage: summarizeSpendByPersonAndStage,
	spendByPersonAndMode: summarizeSpendByPersonAndMode,
})
