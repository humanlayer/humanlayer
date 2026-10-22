import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { PULL_REQUEST_ATTRIBUTION_TIERS } from '@humanlayer/git-attribution'
import { type SQL, sql, type SQLWrapper } from 'drizzle-orm'

const TIER_ORDER = sql.raw(`array[${PULL_REQUEST_ATTRIBUTION_TIERS.map((tier) => `'${tier}'`).join(',')}]`)

export const tierRank = (tier: SQLWrapper) => sql`coalesce(array_position(${TIER_ORDER}, ${tier}), 0)`

/**
 * A row that names a session without a tier (captured by the panel, a delivery or the retired
 * daemon scan) ranks as `observed`: the session that had the branch is not displaced by another
 * one that merely has it checked out.
 */
export const storedTierRank = sql`case
	when ${pullRequests.attribution_method} is null and ${pullRequests.session_id} is not null
		then ${tierRank(sql`'observed'`)}
	else ${tierRank(pullRequests.attribution_method)}
end`

export const strongerTier = (stored: SQLWrapper, incoming: SQL) =>
	sql`case when ${tierRank(incoming)} > ${tierRank(stored)} then ${incoming} else ${stored} end`
