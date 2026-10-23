import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { BRANCH_ATTRIBUTION_WINDOW_MS } from '@humanlayer/git-attribution'
import { and, desc, eq, gte, isNotNull, or } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { PostgresDb } from '../../../postgres/postgres-db.service'
import type { GitHubIntegrationUnavailableError } from '../../github.errors'
import { capturePullRequestFailure } from '../failure'

/** Who a branch belongs to, as the session that observed it or the record that named it. */
export interface PullRequestSessionLink {
	readonly sessionId: string | null
	readonly taskId: string | null
	readonly resourceOwnerUserId: string | null
}

/**
 * Who a branch belongs to: the session that most recently had the branch checked out,
 * else the newest record on the branch that already names a session or a task.
 */
export const findSessionForBranch = (input: {
	readonly organizationId: string
	readonly repoFullName: string
	readonly branch: string
}): Effect.Effect<PullRequestSessionLink | null, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const repoFullName = input.repoFullName.toLowerCase()
		const seenSince = BigInt((yield* Clock.currentTimeMillis) - BRANCH_ATTRIBUTION_WINDOW_MS)
		const [observed] = yield* postgres.query(
			postgres.client
				.select({
					sessionId: sessionRepositories.session_id,
					taskId: sessionRepositories.task_id,
					resourceOwnerUserId: sessions.resource_owner_user_id,
				})
				.from(sessionRepositories)
				.innerJoin(sessions, eq(sessions.id, sessionRepositories.session_id))
				.where(
					and(
						eq(sessionRepositories.organization_id, input.organizationId),
						eq(sessionRepositories.repo_full_name, repoFullName),
						eq(sessionRepositories.branch, input.branch),
						gte(sessionRepositories.last_seen_at, seenSince),
					),
				)
				.orderBy(desc(sessionRepositories.last_seen_at))
				.limit(1),
		)
		if (observed) return observed

		const [recorded] = yield* postgres.query(
			postgres.client
				.select({
					sessionId: pullRequests.session_id,
					taskId: pullRequests.task_id,
					resourceOwnerUserId: pullRequests.resource_owner_user_id,
				})
				.from(pullRequests)
				.where(
					and(
						eq(pullRequests.organization_id, input.organizationId),
						eq(pullRequests.repo_full_name, repoFullName),
						eq(pullRequests.head_ref, input.branch),
						or(isNotNull(pullRequests.session_id), isNotNull(pullRequests.task_id)),
					),
				)
				.orderBy(desc(pullRequests.updated_at))
				.limit(1),
		)
		return recorded ?? null
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('find_session_for_branch', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.find_session_for_branch', {
			attributes: {
				organization_id: input.organizationId,
				repo_full_name: input.repoFullName,
				branch: input.branch,
			},
		}),
	)

/**
 * The session a commit trailer names, when it is in the org and was observed in the repository.
 * Anyone who can push writes a trailer, so the name alone links nothing.
 */
export const findSessionInRepository = (input: {
	readonly organizationId: string
	readonly repoFullName: string
	readonly sessionId: string
}): Effect.Effect<PullRequestSessionLink | null, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const [session] = yield* postgres.query(
			postgres.client
				.select({
					sessionId: sessions.id,
					taskId: sessions.task_id,
					resourceOwnerUserId: sessions.resource_owner_user_id,
				})
				.from(sessions)
				.innerJoin(sessionRepositories, eq(sessionRepositories.session_id, sessions.id))
				.where(
					and(
						eq(sessions.id, input.sessionId),
						eq(sessions.organization_id, input.organizationId),
						eq(sessionRepositories.organization_id, input.organizationId),
						eq(sessionRepositories.repo_full_name, input.repoFullName.toLowerCase()),
					),
				)
				.limit(1),
		)
		return session ?? null
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('find_session_in_repository', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.find_session_in_repository', {
			attributes: {
				organization_id: input.organizationId,
				repo_full_name: input.repoFullName,
				session_id: input.sessionId,
			},
		}),
	)
