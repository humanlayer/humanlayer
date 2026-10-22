import { PULL_REQUEST_COUNTED_TIERS } from '@humanlayer/git-attribution'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'
import pLimit from 'p-limit'

import { logger } from '../../../logger'
import { apiBaseForAdvancedMetrics } from '../../base'
import { resolveMetricsRange } from './utils'

// Belt-and-suspenders cap on how many of this handler's read-replica queries run
// at once. They're independent so they *can* all run concurrently, but bounding
// the fan-out keeps a single request from grabbing more than a few of the shared
// read-replica pool connections (DB_POOL_MAX defaults to 10 — see db/db.ts), so a
// burst of concurrent dashboard loads can't monopolize the pool. The limiter is
// created per request, so this is a per-invocation cap, not a global one.
const SCATTER_QUERY_CONCURRENCY = 3

/**
 * Per-user aggregate cost/tokens/LOC/PR metrics for the org-facing scatter
 * plot. Three separate grouped queries (usage, commits, merged PRs) merged
 * in JS by userId — a user appears in `data` if they have ANY of the three.
 * Missing aggregates default to 0 (costUsd included — scatter axes are numeric).
 *
 * The three aggregate queries have no data dependencies on each other, so they
 * run concurrently — bounded to SCATTER_QUERY_CONCURRENCY at a time — instead
 * of sequentially. Wall-clock latency is roughly the slowest of the three
 * rather than the sum of the round-trips.
 *
 * The filter dropdowns' option lists used to be returned here too, recomputed
 * with the range, which also forced a filtered card to make a SECOND unfiltered
 * request just to obtain them. They now live in `scatterFilterOptions`, which
 * takes no range and is fetched once per page load.
 *
 * Access: plan entitlement + the page's audience, both enforced by
 * apiBaseForAdvancedMetrics.
 */
export const usersScatterProcedure = apiBaseForAdvancedMetrics.metrics.usersScatter.handler(
	async ({ context, input }) => {
		const { dbReadReplica } = context.services
		const { organizationId } = context.auth

		try {
			// The same bucket-aligned range every other card on the page reads, so
			// the KPI cards and the trend chart describe the same span of time.
			// There is no bucket dimension here — these are aggregates over the
			// whole range — but the bounds come from the one resolver so a
			// boundary can never drift between this card and its neighbours.
			const { startTimestamp, endTimestamp, startDate, endDate } = resolveMetricsRange(input)

			const models = input.models && input.models.length > 0 ? input.models : undefined
			const agents = input.agents && input.agents.length > 0 ? input.agents : undefined
			const repos = input.repos && input.repos.length > 0 ? input.repos : undefined

			// Each query is an independent read-replica round-trip with no cross-dependencies.
			// Collect them as named thunks and apply the concurrency cap uniformly with
			// `.map(runBounded)` — adding a query is one entry in the array below, not another
			// hand-wrapped `limit(() => …)`. Bounded so one request can't grab too many pool
			// connections at once (per-request limiter).
			const limit = pLimit(SCATTER_QUERY_CONCURRENCY)
			const runBounded = <T>(query: () => PromiseLike<T>) => limit(query)

			const usageQuery = () =>
				dbReadReplica.execute<{
					user_id: string
					cost_usd: number | null
					input_tokens: string
					output_tokens: string
				}>(sql`
					SELECT
						session_creator_user_id AS user_id,
						SUM(cost_usd) AS cost_usd,
						SUM(input_tokens)::text AS input_tokens,
						SUM(output_tokens)::text AS output_tokens
					FROM session_usage_events
					WHERE organization_id = ${organizationId}
						AND occurred_at >= ${startTimestamp}
						AND occurred_at <= ${endTimestamp}
						${models ? sql`AND model IN ${models}` : sql``}
						${agents ? sql`AND coding_agent IN ${agents}` : sql``}
					GROUP BY 1
				`)

			// Commits KNOWN to be human-authored are excluded: the spend numerator
			// is inherently agent-only (usage events exist only for agent
			// sessions), so counting human lines in the denominator divides agent
			// dollars by partly-human output — understating unit cost today and
			// drifting it downward as the phantom-hook work captures more human
			// commits. IS DISTINCT FROM keeps legacy NULL rows ("unknown"), which
			// predate attribution; only positive knowledge excludes.
			//
			// Commits and PRs are credited to the task owner at capture, while usage
			// is credited to the session creator. Every axis of one dot must name
			// the same person, so both are re-keyed through the session; rows with
			// no session keep the captured credit.
			const commitQuery = () =>
				dbReadReplica.execute<{
					user_id: string
					additions: string
					deletions: string
					commit_count: string
				}>(sql`
					SELECT
						COALESCE(s.created_by, c.resource_owner_user_id) AS user_id,
						SUM(c.additions)::text AS additions,
						SUM(c.deletions)::text AS deletions,
						COUNT(*)::text AS commit_count
					FROM authored_commits c
					LEFT JOIN sessions s ON s.id = c.session_id
					WHERE c.organization_id = ${organizationId}
						AND c.committed_at >= ${startTimestamp}
						AND c.committed_at <= ${endTimestamp}
						AND c.attribution_method IS DISTINCT FROM 'human'
						${agents ? sql`AND c.coding_agent IN ${agents}` : sql``}
						${repos ? sql`AND c.repo_full_name IN ${repos}` : sql``}
					GROUP BY 1
				`)

			const prQuery = () =>
				dbReadReplica.execute<{
					user_id: string
					pr_count: string
				}>(sql`
					SELECT
						COALESCE(s.created_by, pr.resource_owner_user_id) AS user_id,
						COUNT(*)::text AS pr_count
					FROM pull_requests pr
					LEFT JOIN sessions s ON s.id = pr.session_id
					WHERE pr.organization_id = ${organizationId}
						AND pr.state = 'merged'
						AND pr.author_is_bot = false
						AND pr.resource_owner_user_id IS NOT NULL
						AND pr.attribution_method IN ${[...PULL_REQUEST_COUNTED_TIERS]}
						AND pr.merged_at >= ${startTimestamp}
						AND pr.merged_at <= ${endTimestamp}
						${repos ? sql`AND pr.repo_full_name IN ${repos}` : sql``}
					GROUP BY 1
				`)

			const [usageRows, commitRows, prRows] = await Promise.all([
				runBounded(usageQuery),
				runBounded(commitQuery),
				runBounded(prQuery),
			])

			const byUser = new Map<
				string,
				{
					userId: string
					costUsd: number
					inputTokens: number
					outputTokens: number
					locAdded: number
					locDeleted: number
					commitCount: number
					prsMerged: number
				}
			>()

			const getOrCreate = (userId: string) => {
				let row = byUser.get(userId)
				if (!row) {
					row = {
						userId,
						costUsd: 0,
						inputTokens: 0,
						outputTokens: 0,
						locAdded: 0,
						locDeleted: 0,
						commitCount: 0,
						prsMerged: 0,
					}
					byUser.set(userId, row)
				}
				return row
			}

			for (const row of usageRows as Array<Record<string, unknown>>) {
				const entry = getOrCreate(String(row.user_id))
				entry.costUsd = row.cost_usd === null || row.cost_usd === undefined ? 0 : Number(row.cost_usd)
				entry.inputTokens = Number.parseInt(String(row.input_tokens), 10)
				entry.outputTokens = Number.parseInt(String(row.output_tokens), 10)
			}

			for (const row of commitRows as Array<Record<string, unknown>>) {
				const entry = getOrCreate(String(row.user_id))
				entry.locAdded = Number.parseInt(String(row.additions), 10)
				entry.locDeleted = Number.parseInt(String(row.deletions), 10)
				entry.commitCount = Number.parseInt(String(row.commit_count), 10)
			}

			for (const row of prRows as Array<Record<string, unknown>>) {
				const entry = getOrCreate(String(row.user_id))
				entry.prsMerged = Number.parseInt(String(row.pr_count), 10)
			}

			return {
				data: Array.from(byUser.values()),
				// Echo of the requested range, identical to every sibling card's,
				// so adjacent captions read the same dates instead of this one
				// ending "today".
				startDate,
				endDate,
			}
		} catch (error) {
			// Base (apiBaseForAdvancedMetrics) also forwards to Sentry; log with
			// context + a procedure tag here so query failures are triageable.
			logger.error({ error, organizationId, from: input.from, to: input.to }, 'metrics.usersScatter query failed')
			Sentry.captureException(error, { tags: { procedure: 'metrics.usersScatter' } })
			throw error
		}
	},
)
