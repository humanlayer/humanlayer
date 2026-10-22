import { PULL_REQUEST_COUNTED_TIERS } from '@humanlayer/git-attribution'
import { CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { resolveHistoryWindow } from './utils'

/**
 * The values the scatter's model / agent / repo dropdowns offer.
 *
 * Range-INDEPENDENT by design — see the contract. These three
 * `DISTINCT`/`UNION` scans used to ride along on `usersScatter` and be re-run
 * on every range change, and a filtered scatter had to make a SECOND,
 * unfiltered `usersScatter` request purely to get them. Splitting them out
 * takes a filtered card from nine queries per range change to three, and these
 * are fetched once per page load.
 *
 * The window is the brush's own span (RANGE_HISTORY_DAYS), so it is bounded —
 * an org-wide `DISTINCT` over all history would grow without limit — while
 * still covering every range the brush can select.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const scatterFilterOptionsProcedure = apiBaseForAdvancedMetrics.metrics.scatterFilterOptions.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth
		const offsetMinutes = input.timezoneOffset ?? 0

		try {
			// The same window rangeOverview uses, so the options span exactly the
			// strip the brush draws.
			const { startTimestamp, endTimestamp } = resolveHistoryWindow(offsetMinutes)

			const modelsQuery = dbReadReplica.execute<{ model: string }>(sql`
				SELECT DISTINCT model
				FROM session_usage_events
				WHERE organization_id = ${organizationId}
					AND occurred_at >= ${startTimestamp}
					AND occurred_at <= ${endTimestamp}
				ORDER BY model
			`)

			const agentsQuery = dbReadReplica.execute<{ agent: string }>(sql`
				SELECT DISTINCT agent FROM (
					SELECT coding_agent AS agent
					FROM session_usage_events
					WHERE organization_id = ${organizationId}
						AND occurred_at >= ${startTimestamp}
						AND occurred_at <= ${endTimestamp}
					UNION
					SELECT coding_agent
					FROM authored_commits
					WHERE organization_id = ${organizationId}
						AND committed_at >= ${startTimestamp}
						AND committed_at <= ${endTimestamp}
						AND attribution_method IS DISTINCT FROM 'human'
				) agents_union
				WHERE agent IS NOT NULL
				ORDER BY agent
			`)

			const reposQuery = dbReadReplica.execute<{ repo: string }>(sql`
				SELECT DISTINCT repo FROM (
					SELECT repo_full_name AS repo
					FROM authored_commits
					WHERE organization_id = ${organizationId}
						AND committed_at >= ${startTimestamp}
						AND committed_at <= ${endTimestamp}
						AND attribution_method IS DISTINCT FROM 'human'
					UNION
					SELECT repo_full_name
					FROM pull_requests
					WHERE organization_id = ${organizationId}
						AND state = 'merged'
						AND attribution_method IN ${[...PULL_REQUEST_COUNTED_TIERS]}
						AND merged_at >= ${startTimestamp}
						AND merged_at <= ${endTimestamp}
				) repos_union
				WHERE repo IS NOT NULL
				ORDER BY repo
			`)

			const [modelRows, agentRows, repoRows] = await Promise.all([modelsQuery, agentsQuery, reposQuery])

			return {
				models: (modelRows as Array<Record<string, unknown>>).map((row) => String(row.model)),
				agents: CodingAgentZodSchema.array().parse(
					(agentRows as Array<Record<string, unknown>>).map((row) => String(row.agent)),
				),
				repos: (repoRows as Array<Record<string, unknown>>).map((row) => String(row.repo)),
			}
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error({ error, organizationId }, 'metrics.scatterFilterOptions query failed')
			Sentry.captureException(error, { tags: { procedure: 'metrics.scatterFilterOptions' } })
			throw error
		}
	},
)
