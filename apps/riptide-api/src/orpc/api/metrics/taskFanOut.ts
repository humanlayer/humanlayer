import { TASK_FAN_OUT_MODEL_CAP } from '@humanlayer/riptide-api-contract/api/metrics/taskFanOut'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { resolveMetricsRange } from './utils'

type FanOutRow = {
	dimension: 'contributors' | 'agents' | 'models'
	count: number | string
	folded: boolean
	task_count: number | string
	tokens: number | string
	cost_usd: number | string | null
}

const num = (value: number | string | null | undefined): number =>
	value === null || value === undefined ? 0 : Number(value)

/**
 * Tasks bucketed by how far the work fanned out: how many people, how many
 * coding agents, how many models.
 *
 * All three dimensions come from ONE pass over the range (`per_task` computes
 * the three counts, then three grouped selects read it), so the three
 * distributions always describe the same population — three separate queries
 * could straddle a write and disagree about the task count.
 *
 * PRIVACY: the contributor dimension groups by `count(distinct
 * session_creator_user_id … )` and never selects a user id, so this endpoint
 * cannot be used to derive a per-person total. It answers "how many people",
 * never "which".
 *
 * Model counts above {@link TASK_FAN_OUT_MODEL_CAP} fold into one "or more"
 * bucket — the dev tail runs to ten distinct models on a single task, which is
 * ten unreadable rows for one real finding.
 */
export const taskFanOutProcedure = apiBaseForAdvancedMetrics.metrics.taskFanOut.handler(async ({ context, input }) => {
	const { dbReadReplica } = context.services
	const { organizationId } = context.auth

	try {
		const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)

		const rows = await dbReadReplica.execute<FanOutRow>(sql`
				WITH usage_rows AS (
					SELECT
						u.task_id,
						u.session_creator_user_id,
						u.coding_agent,
						u.model,
						u.cost_usd,
						u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_creation_tokens
							AS total_tokens
					FROM session_usage_events u
					WHERE u.organization_id = ${organizationId}
						AND u.occurred_at >= ${startTimestamp}
						AND u.occurred_at <= ${endTimestamp}
						AND u.task_id IS NOT NULL
				),
				per_task AS (
					SELECT
						ur.task_id,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd,
						COUNT(DISTINCT ur.coding_agent)::int AS agent_count,
						COUNT(DISTINCT ur.model)::int AS model_count,
						(
							SELECT COUNT(DISTINCT person)::int
							FROM UNNEST(
								ARRAY_AGG(DISTINCT ur.session_creator_user_id) || ARRAY[MAX(t.created_by)]
							) AS person
						) AS contributor_count
					FROM usage_rows ur
					JOIN tasks t ON t.id = ur.task_id
					GROUP BY ur.task_id
				),
				-- One row per (dimension, bucket). LEAST() does the model fold, and
				-- carries the flag that tells the client to label it "or more".
				bucketed AS (
					SELECT 'contributors' AS dimension, contributor_count AS count, FALSE AS folded,
						tokens, cost_usd FROM per_task
					UNION ALL
					SELECT 'agents', agent_count, FALSE, tokens, cost_usd FROM per_task
					UNION ALL
					SELECT 'models', LEAST(model_count, ${TASK_FAN_OUT_MODEL_CAP}),
						model_count > ${TASK_FAN_OUT_MODEL_CAP}, tokens, cost_usd FROM per_task
				)
				SELECT
					dimension,
					count,
					BOOL_OR(folded) AS folded,
					COUNT(*)::int AS task_count,
					COALESCE(SUM(tokens), 0)::bigint AS tokens,
					COALESCE(SUM(cost_usd), 0) AS cost_usd
				FROM bucketed
				GROUP BY dimension, count
				ORDER BY dimension, count
			`)

		const fanOutRows = rows
		const bucketsFor = (dimension: FanOutRow['dimension']) =>
			fanOutRows
				.filter((row) => row.dimension === dimension)
				.map((row) => ({
					count: num(row.count),
					folded: row.folded === true,
					taskCount: num(row.task_count),
					tokens: num(row.tokens),
					costUsd: num(row.cost_usd),
				}))

		// Every dimension partitions the same tasks, so any one of them totals
		// the range. Contributors is used because it never folds.
		const contributors = bucketsFor('contributors')

		return {
			contributors,
			agents: bucketsFor('agents'),
			models: bucketsFor('models'),
			taskCount: contributors.reduce((sum, bucket) => sum + bucket.taskCount, 0),
			tokens: contributors.reduce((sum, bucket) => sum + bucket.tokens, 0),
			startDate,
			endDate,
		}
	} catch (error) {
		logger.error({ error, organizationId, from: input.from, to: input.to }, 'metrics.taskFanOut query failed')
		Sentry.captureException(error, { tags: { procedure: 'metrics.taskFanOut' } })
		throw error
	}
})
