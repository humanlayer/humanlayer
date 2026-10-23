import { NO_STAGE_KEY } from '@humanlayer/riptide-api-contract/api/metrics/stageSpendTrend'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { mostProgressedStageSql } from '../../../effects/services/metrics/stage-attribution'
import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { resolveMetricsRange } from './utils'

type TaskRow = {
	task_id: string
	name: string | null
	ticket_id: string | null
	session_count: number | string
	tokens: number | string
	cost_usd: number | string | null
	contributor_count: number | string
	model_count: number | string
	mode: string | null
	agents: Array<{ agent: string; tokens: number | string; cost_usd: number | string | null }> | null
	models: Array<{ model: string; tokens: number | string; cost_usd: number | string | null }> | null
	stages: Array<{ stage: string; tokens: number | string; cost_usd: number | string | null }> | null
	contributors: Array<{ user_id: string; tokens: number | string; cost_usd: number | string | null }> | null
	// Matched-set totals, carried on every row by a window over per_task. They
	// describe the whole filtered range, not the page.
	matched_task_count: number | string
	matched_tokens: number | string
	matched_cost_usd: number | string | null
	max_value: number | string | null
	// The keyset this row would be resumed from.
	cursor_value: number | string | null
}

/** Postgres returns bigint/numeric as strings; every aggregate here goes through this. */
const num = (value: number | string | null | undefined): number =>
	value === null || value === undefined ? 0 : Number(value)

/**
 * One page of the range's tasks, ranked by tokens or by cost, with the totals
 * of the whole matched set.
 *
 * ## Why the measure is a server input
 *
 * The two rankings are different POPULATIONS, not one list re-sorted. Agents
 * bill at very different rates per token, so a task can be expensive without
 * being heavy; on dev only 8 of the top 12 by tokens are also in the top 12 by
 * cost. Ranking server-side means each measure sees the tasks it should.
 *
 * ## Why search is here and not on the client
 *
 * The client holds one page. Filtering there would search 25 rows and report
 * a matching task that sits on page 4 as absent — the box would silently lie.
 *
 * ## Why the totals come from a window, not a second query
 *
 * `per_task` carries matched-set totals via `COUNT(*) OVER ()` / `SUM(…) OVER
 * ()` / `MAX(…) OVER ()`. One scan instead of two, and the parts cannot drift
 * from the whole the way two independently filtered queries can. The windows
 * run BEFORE the keyset filter, so every page reports the same totals.
 *
 * ## Contributors
 *
 * `contributor_count` counts distinct session creators unioned with the task's
 * `created_by`, so a task created by one person and worked by another reads as
 * 2. It is kept beside `contributors` because only the count sees the creator:
 * someone who opened a task and never ran a session bills no tokens and so has
 * no row in `person_split`.
 *
 * The per-person totals in `contributors` DO carry user ids — see the contract,
 * which records why that earlier restriction was lifted. Same admin + Advanced
 * Metrics gate as userStageSpend and userModeSpend.
 *
 * ## Cost of the four splits
 *
 * `agent_split`, `model_split` and `person_split` re-aggregate `usage_rows`,
 * which is already materialized; `stage_split` additionally unnests
 * `sessions.labels` once per session on the PAGE (25 rows), not once per usage
 * row and not over the range. All four are scoped by `task_id IN (SELECT
 * task_id FROM ranked)`, so page size bounds the work rather than range size.
 *
 * Served by the existing (organization_id, occurred_at) index prefix on
 * session_usage_events — no new index.
 *
 * Access: plan entitlement + the page's audience, both enforced by apiBaseForAdvancedMetrics.
 */
export const tokenUseByTaskProcedure = apiBaseForAdvancedMetrics.metrics.tokenUseByTask.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)
			// Already validated by the contract — shape, numeric range and uuid.
			const { limit, cursor } = input

			// The ORDER BY column, chosen by the requested measure. A bind parameter
			// cannot name a column, so this is a closed switch over the contract's
			// enum rather than interpolated input.
			const byCost = input.measure === 'cost'
			const rankColumn = byCost ? sql`cost_usd` : sql`tokens`

			// Ordered DESC on BOTH keys so the keyset is a plain row comparison.
			// Mixing directions (value DESC, id ASC) would need the comparison
			// spelled out as an OR of two predicates, which the planner handles
			// worse and which is far easier to get subtly wrong.
			// Cast to the column's OWN type on both sides. cost_usd is float8, so
			// `::double precision` compares float to float; casting to numeric
			// instead would make Postgres convert back and could land the boundary
			// on the wrong side of the row the cursor names.
			const keyset = cursor
				? byCost
					? sql`WHERE (cost_usd, task_id) < (${cursor.value}::double precision, ${cursor.taskId})`
					: sql`WHERE (tokens, task_id) < (${cursor.value}::bigint, ${cursor.taskId})`
				: sql``

			// ILIKE on both the name and the ticket, so "eng-22" and "composer"
			// both find the same task. The pattern is a bind parameter; only the
			// wildcards are literal — and the user's own text is escaped first, or
			// searching for "100%" would match every task and "a_b" would match
			// "aXb". Backslash first, so it does not double-escape the two after it.
			const pattern = input.search ? `%${input.search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` : null
			const searchFilter = pattern ? sql`WHERE (t.name ILIKE ${pattern} OR t.ticket_id ILIKE ${pattern})` : sql``

			const rows = await dbReadReplica.execute<TaskRow>(sql`
				WITH usage_rows AS (
					SELECT
						u.task_id,
						u.session_id,
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
						COUNT(DISTINCT ur.session_id)::int AS session_count,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd,
						COUNT(DISTINCT ur.model)::int AS model_count,
						-- The task's own creator counts even when every session on it
						-- belongs to someone else — that handoff is precisely the case
						-- this count exists to surface.
						(
							SELECT COUNT(DISTINCT person)::int
							FROM UNNEST(
								ARRAY_AGG(DISTINCT ur.session_creator_user_id) || ARRAY[MAX(t.created_by)]
							) AS person
						) AS contributor_count
					FROM usage_rows ur
					JOIN tasks t ON t.id = ur.task_id
					${searchFilter}
					GROUP BY ur.task_id
				),
				with_totals AS (
					SELECT
						p.*,
						COUNT(*) OVER ()::int AS matched_task_count,
						SUM(p.tokens) OVER ()::bigint AS matched_tokens,
						SUM(p.cost_usd) OVER () AS matched_cost_usd,
						MAX(p.${rankColumn}) OVER () AS max_value
					FROM per_task p
				),
				ranked AS (
					SELECT * FROM with_totals
					${keyset}
					ORDER BY ${rankColumn} DESC, task_id DESC
					LIMIT ${limit}
				),
				agent_split AS (
					SELECT
						ur.task_id,
						ur.coding_agent AS agent,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd
					FROM usage_rows ur
					WHERE ur.task_id IN (SELECT task_id FROM ranked)
					GROUP BY ur.task_id, ur.coding_agent
				),
				model_split AS (
					SELECT
						ur.task_id,
						ur.model,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd
					FROM usage_rows ur
					WHERE ur.task_id IN (SELECT task_id FROM ranked)
					GROUP BY ur.task_id, ur.model
				),
				-- The label unnest runs once per SESSION on the page, not once per
				-- usage row, and only for sessions belonging to the ranked tasks —
				-- the same shape stageSpendTrend uses, scoped to one page.
				session_stage AS (
					SELECT s.id, ${mostProgressedStageSql()} AS stage
					FROM sessions s
					WHERE s.id IN (
						SELECT DISTINCT ur.session_id
						FROM usage_rows ur
						WHERE ur.task_id IN (SELECT task_id FROM ranked)
					)
				),
				stage_split AS (
					SELECT
						ur.task_id,
						COALESCE(ss.stage, ${NO_STAGE_KEY}) AS stage,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd
					FROM usage_rows ur
					JOIN session_stage ss ON ss.id = ur.session_id
					WHERE ur.task_id IN (SELECT task_id FROM ranked)
					GROUP BY ur.task_id, 2
				),
				person_split AS (
					SELECT
						ur.task_id,
						ur.session_creator_user_id AS user_id,
						COALESCE(SUM(ur.total_tokens), 0)::bigint AS tokens,
						COALESCE(SUM(ur.cost_usd), 0) AS cost_usd
					FROM usage_rows ur
					WHERE ur.task_id IN (SELECT task_id FROM ranked)
					GROUP BY ur.task_id, ur.session_creator_user_id
				)
				SELECT
					r.task_id,
					t.name,
					t.ticket_id,
					r.session_count,
					r.tokens,
					r.cost_usd,
					r.contributor_count,
					r.model_count,
					r.matched_task_count,
					r.matched_tokens,
					r.matched_cost_usd,
					r.max_value,
					r.${rankColumn} AS cursor_value,
					COALESCE(
						(
							SELECT JSON_AGG(
								JSON_BUILD_OBJECT('agent', a.agent, 'tokens', a.tokens, 'cost_usd', a.cost_usd)
								ORDER BY a.tokens DESC
							)
							FROM agent_split a WHERE a.task_id = r.task_id
						),
						'[]'::json
					) AS agents,
					COALESCE(
						(
							SELECT JSON_AGG(
								JSON_BUILD_OBJECT('model', m.model, 'tokens', m.tokens, 'cost_usd', m.cost_usd)
								ORDER BY m.tokens DESC
							)
							FROM model_split m WHERE m.task_id = r.task_id
						),
						'[]'::json
					) AS models,
					t.workflow_type AS mode,
					COALESCE(
						(
							SELECT JSON_AGG(
								JSON_BUILD_OBJECT('stage', g.stage, 'tokens', g.tokens, 'cost_usd', g.cost_usd)
								ORDER BY g.tokens DESC
							)
							FROM stage_split g WHERE g.task_id = r.task_id
						),
						'[]'::json
					) AS stages,
					COALESCE(
						(
							SELECT JSON_AGG(
								JSON_BUILD_OBJECT('user_id', c.user_id, 'tokens', c.tokens, 'cost_usd', c.cost_usd)
								ORDER BY c.tokens DESC
							)
							FROM person_split c WHERE c.task_id = r.task_id
						),
						'[]'::json
					) AS contributors
				FROM ranked r
				JOIN tasks t ON t.id = r.task_id
				ORDER BY r.${rankColumn} DESC, r.task_id DESC
			`)

			const taskRows = rows

			const data = taskRows.map((row) => ({
				taskId: String(row.task_id),
				name: row.name ?? '',
				ticketId: row.ticket_id,
				sessionCount: num(row.session_count),
				tokens: num(row.tokens),
				costUsd: num(row.cost_usd),
				contributorCount: num(row.contributor_count),
				modelCount: num(row.model_count),
				agents: (row.agents ?? []).map((entry) => ({
					agent: entry.agent as CodingAgent,
					tokens: num(entry.tokens),
					costUsd: num(entry.cost_usd),
				})),
				models: (row.models ?? []).map((entry) => ({
					model: String(entry.model),
					tokens: num(entry.tokens),
					costUsd: num(entry.cost_usd),
				})),
				mode: String(row.mode ?? ''),
				stages: (row.stages ?? []).map((entry) => ({
					stage: String(entry.stage),
					tokens: num(entry.tokens),
					costUsd: num(entry.cost_usd),
				})),
				contributors: (row.contributors ?? []).map((entry) => ({
					userId: String(entry.user_id),
					tokens: num(entry.tokens),
					costUsd: num(entry.cost_usd),
				})),
			}))

			// Totals are identical on every row (window over the whole matched CTE).
			// An empty page means the range or the filter matched nothing, and the
			// totals are then genuinely zero.
			const totals = taskRows[0]
			// A short page is the last page. Deriving it from the row count rather
			// than from a separate count keeps the two from disagreeing, and
			// guarantees the scroll terminates.
			const last = taskRows[taskRows.length - 1]
			// A number, via the same `num` every other aggregate goes through. The
			// driver hands back int8 as a string and float8 already parsed, so this
			// is the one place both shapes become the single thing the contract
			// accepts.
			const nextCursor =
				taskRows.length === limit && last
					? { value: num(last.cursor_value), taskId: String(last.task_id) }
					: null

			return {
				data,
				measure: input.measure,
				nextCursor,
				matched: {
					taskCount: num(totals?.matched_task_count),
					tokens: num(totals?.matched_tokens),
					costUsd: num(totals?.matched_cost_usd),
				},
				maxValue: num(totals?.max_value),
				startDate,
				endDate,
			}
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to, measure: input.measure },
				'metrics.tokenUseByTask query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.tokenUseByTask' } })
			throw error
		}
	},
)
