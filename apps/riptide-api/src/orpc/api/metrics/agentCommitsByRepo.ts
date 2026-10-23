import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { resolveMetricsRange } from './utils'

/**
 * HumanLayer-attributed commit counts per repository over the range, split
 * by attribution tier. One grouped query over the commits ledger; the tier
 * pivot happens in JS so the SQL stays a plain GROUP BY that the existing
 * (organization_id, …, committed_at) index prefix serves — no new index.
 *
 * Counting rules, all deliberate:
 * - `confirmed` (commit trailer names the session) and `inferred` (line-hash
 *   overlap heuristic) are the only tiers counted as HumanLayer commits.
 * - `human` and legacy NULL `attribution_method` rows are never counted.
 *   `attribution_method IN (…)` drops NULLs on its own (NULL never matches
 *   IN), so legacy rows can't leak in through the back door.
 * - Rows with a NULL `repo_full_name` (unparseable remote, no remote) are
 *   EXCLUDED rather than bucketed as "unknown": a single bar aggregating
 *   commits from many unrelated repos isn't a repository and can't be
 *   reasoned about or drilled into. The card's popover discloses this.
 *
 * Absolute counts only — no share, no ratio against human commits (see the
 * contract for why a share would lie).
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const agentCommitsByRepoProcedure = apiBaseForAdvancedMetrics.metrics.agentCommitsByRepo.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			// No bucket expression: this card ranks repos over the range as a
			// whole, so the bucket size never reaches its SQL. It still takes the
			// range (and `bucket`, via the shared input) so its cache key moves in
			// step with the rest of the page.
			const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)

			const rows = await dbReadReplica.execute<{
				repo_full_name: string
				attribution_method: string
				commit_count: string
			}>(sql`
				SELECT
					repo_full_name,
					attribution_method,
					COUNT(*)::text AS commit_count
				FROM authored_commits
				WHERE organization_id = ${organizationId}
					AND committed_at >= ${startTimestamp}
					AND committed_at <= ${endTimestamp}
					AND repo_full_name IS NOT NULL
					AND attribution_method IN ('confirmed', 'inferred')
				GROUP BY 1, 2
			`)

			const byRepo = new Map<string, { repoFullName: string; confirmedCount: number; inferredCount: number }>()

			for (const row of rows as Array<Record<string, unknown>>) {
				const repoFullName = String(row.repo_full_name)
				let entry = byRepo.get(repoFullName)
				if (!entry) {
					entry = { repoFullName, confirmedCount: 0, inferredCount: 0 }
					byRepo.set(repoFullName, entry)
				}
				const count = Number.parseInt(String(row.commit_count), 10)
				if (row.attribution_method === 'confirmed') entry.confirmedCount = count
				else entry.inferredCount = count
			}

			return { data: Array.from(byRepo.values()), startDate, endDate }
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error(
				{ error, organizationId, from: input.from, to: input.to },
				'metrics.agentCommitsByRepo query failed',
			)
			Sentry.captureException(error, { tags: { procedure: 'metrics.agentCommitsByRepo' } })
			throw error
		}
	},
)
