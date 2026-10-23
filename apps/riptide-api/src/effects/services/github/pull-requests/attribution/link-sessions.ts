import { pullRequestSessions } from '@humanlayer/db/tables/pull-request-sessions'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import {
	attributePullRequest,
	BRANCH_ATTRIBUTION_WINDOW_MS,
	type PullRequestAttributionTier,
} from '@humanlayer/git-attribution'
import { and, eq, type SQL, sql, type SQLWrapper } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { PostgresDb } from '../../../postgres/postgres-db.service'
import type { GitHubIntegrationUnavailableError } from '../../github.errors'
import { capturePullRequestFailure } from '../failure'
import { type SessionOnBranch, selectSessionsThatTouchedBranch } from './sessions-on-branch'
import { storedTierRank, strongerTier, tierRank } from './tiers'

export interface LinkedPullRequestSessions {
	/** The strongest tier across every session linked now, null when no session touched the branch. */
	readonly attributionMethod: PullRequestAttributionTier | null
	readonly sessionCount: number
}

interface PullRequestKey {
	readonly organizationId: string
	readonly repoFullName: string
	readonly number: number
}

const upsertSessionLinks = (
	input: PullRequestKey & {
		readonly sessions: ReadonlyArray<{
			readonly session: SessionOnBranch
			readonly tier: PullRequestAttributionTier
		}>
		readonly linkedAt: bigint
	},
) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		if (input.sessions.length === 0) return
		yield* postgres.query(
			postgres.client
				.insert(pullRequestSessions)
				.values(
					input.sessions.map(({ session, tier }) => ({
						organization_id: input.organizationId,
						repo_full_name: input.repoFullName,
						number: input.number,
						session_id: session.sessionId,
						task_id: session.taskId,
						user_id: session.resourceOwnerUserId,
						tier,
						linked_at: input.linkedAt,
					})),
				)
				.onConflictDoUpdate({
					target: [
						pullRequestSessions.organization_id,
						pullRequestSessions.repo_full_name,
						pullRequestSessions.number,
						pullRequestSessions.session_id,
					],
					set: {
						task_id: sql`coalesce(${pullRequestSessions.task_id}, excluded.task_id)`,
						user_id: sql`coalesce(${pullRequestSessions.user_id}, excluded.user_id)`,
						tier: strongerTier(pullRequestSessions.tier, sql`excluded.tier`),
						updated_at: input.linkedAt,
					},
				}),
		)
	})

const creditPullRequestToStrongestSession = (
	input: PullRequestKey & {
		readonly session: SessionOnBranch
		readonly tier: PullRequestAttributionTier
		readonly linkedAt: bigint
	},
) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const incomingTier = sql`${input.tier}`
		const outranksStoredTier = sql`${tierRank(incomingTier)} > ${storedTierRank}`
		/** The strongest session takes the column over, but a session that knows nothing clears nothing. */
		const takeOverOrKeep = (stored: SQLWrapper, incoming: SQL) =>
			sql`case when ${outranksStoredTier} then coalesce(${incoming}, ${stored}) else coalesce(${stored}, ${incoming}) end`
		yield* postgres.query(
			postgres.client
				.update(pullRequests)
				.set({
					attribution_method: strongerTier(pullRequests.attribution_method, incomingTier),
					session_id: takeOverOrKeep(pullRequests.session_id, sql`${input.session.sessionId}::uuid`),
					task_id: takeOverOrKeep(pullRequests.task_id, sql`${input.session.taskId}::uuid`),
					resource_owner_user_id: takeOverOrKeep(
						pullRequests.resource_owner_user_id,
						sql`${input.session.resourceOwnerUserId}`,
					),
					updated_at: input.linkedAt,
				})
				.where(
					and(
						eq(pullRequests.organization_id, input.organizationId),
						eq(pullRequests.repo_full_name, input.repoFullName),
						eq(pullRequests.number, input.number),
					),
				),
		)
	})

export const linkPullRequestSessions = (input: {
	readonly organizationId: string
	readonly repoFullName: string
	readonly branch: string
	readonly headSha: string | null
	readonly number: number
}): Effect.Effect<LinkedPullRequestSessions, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const repoFullName = input.repoFullName.toLowerCase()
		const now = yield* Clock.currentTimeMillis
		const sessionsOnBranch = yield* selectSessionsThatTouchedBranch({
			organizationId: input.organizationId,
			repoFullName,
			branch: input.branch,
			headSha: input.headSha,
			since: now - BRANCH_ATTRIBUTION_WINDOW_MS,
		})
		const attributed = attributePullRequest({
			now,
			sessions: [...sessionsOnBranch.values()].map((session) => ({
				sessionId: session.sessionId,
				committedOnBranch: session.committedOnBranch,
				lastSeenAt: Number(session.lastSeenAt),
			})),
		})
		if (attributed.strongest === null) return { attributionMethod: null, sessionCount: 0 }

		const pullRequest = { organizationId: input.organizationId, repoFullName, number: input.number }
		const linkedAt = BigInt(now)
		const linked = attributed.sessions.flatMap(({ sessionId, tier }) => {
			const session = sessionsOnBranch.get(sessionId)
			return session ? [{ session, tier }] : []
		})
		yield* upsertSessionLinks({ ...pullRequest, sessions: linked, linkedAt })

		const strongest = sessionsOnBranch.get(attributed.strongest.sessionId)
		if (strongest)
			yield* creditPullRequestToStrongestSession({
				...pullRequest,
				session: strongest,
				tier: attributed.strongest.tier,
				linkedAt,
			})
		return { attributionMethod: attributed.strongest.tier, sessionCount: linked.length }
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('link_pull_request_sessions', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.link_sessions', {
			attributes: {
				organization_id: input.organizationId,
				repo_full_name: input.repoFullName,
				branch: input.branch,
				number: input.number,
			},
		}),
	)
