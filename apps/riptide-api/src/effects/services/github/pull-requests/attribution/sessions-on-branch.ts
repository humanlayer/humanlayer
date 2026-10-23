import { commits } from '@humanlayer/db/tables/commits'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { PostgresDb } from '../../../postgres/postgres-db.service'

/** A session's whole involvement with one branch, folded across every checkout it had of it. */
export interface SessionOnBranch {
	readonly sessionId: string
	readonly taskId: string | null
	readonly resourceOwnerUserId: string
	readonly committedOnBranch: boolean
	readonly lastSeenAt: bigint
}

/** The newest entry names the task and owner; the strongest evidence across all of them decides the tier. */
const foldIntoOneEntryPerSession = (newestFirst: readonly SessionOnBranch[]): ReadonlyMap<string, SessionOnBranch> => {
	const bySessionId = new Map<string, SessionOnBranch>()
	for (const entry of newestFirst) {
		const newest = bySessionId.get(entry.sessionId)
		bySessionId.set(
			entry.sessionId,
			newest ? { ...newest, committedOnBranch: newest.committedOnBranch || entry.committedOnBranch } : entry,
		)
	}
	return bySessionId
}

const newestFirst = (entries: readonly SessionOnBranch[]): SessionOnBranch[] =>
	[...entries].sort((a, b) => (a.lastSeenAt === b.lastSeenAt ? 0 : a.lastSeenAt > b.lastSeenAt ? -1 : 1))

/**
 * Every session that had the branch checked out, plus the session that made the head commit.
 *
 * The head commit is the one piece of evidence the checkout observer cannot miss: a subagent
 * committing in its own worktree inherits the session env, so the commit reaches the ledger
 * stamped with the session even though no checkout of the branch was ever observed, and the
 * ledger files it under whichever branch the workspace surfaced it on, not the head branch.
 * Matching the SHA sidesteps both.
 */
export const selectSessionsThatTouchedBranch = (input: {
	readonly organizationId: string
	readonly repoFullName: string
	readonly branch: string
	readonly headSha: string | null
	readonly since: number
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const since = BigInt(input.since)
		const committedOnBranch = sql<boolean>`exists (
			select 1 from ${commits}
			where ${commits.organization_id} = ${sessionRepositories.organization_id}
				and ${commits.session_id} = ${sessionRepositories.session_id}
				and ${commits.repo_full_name} = ${sessionRepositories.repo_full_name}
				and ${commits.branch} = ${sessionRepositories.branch}
		)`
		const checkouts: readonly SessionOnBranch[] = yield* postgres.query(
			postgres.client
				.select({
					sessionId: sessionRepositories.session_id,
					taskId: sessionRepositories.task_id,
					resourceOwnerUserId: sessions.resource_owner_user_id,
					committedOnBranch,
					lastSeenAt: sessionRepositories.last_seen_at,
				})
				.from(sessionRepositories)
				.innerJoin(sessions, eq(sessions.id, sessionRepositories.session_id))
				.where(
					and(
						eq(sessionRepositories.organization_id, input.organizationId),
						eq(sessionRepositories.repo_full_name, input.repoFullName),
						eq(sessionRepositories.branch, input.branch),
						gte(sessionRepositories.last_seen_at, since),
					),
				)
				.orderBy(desc(sessionRepositories.last_seen_at)),
		)
		const headCommitters: readonly SessionOnBranch[] =
			input.headSha === null
				? []
				: yield* postgres.query(
						postgres.client
							.select({
								sessionId: sql<string>`${commits.session_id}`,
								taskId: sessions.task_id,
								resourceOwnerUserId: sessions.resource_owner_user_id,
								committedOnBranch: sql<boolean>`true`,
								lastSeenAt: commits.committed_at,
							})
							.from(commits)
							.innerJoin(sessions, eq(sessions.id, commits.session_id))
							.where(
								and(
									eq(commits.organization_id, input.organizationId),
									eq(commits.commit_sha, input.headSha),
									isNotNull(commits.session_id),
									gte(commits.committed_at, since),
								),
							),
					)
		return foldIntoOneEntryPerSession(newestFirst([...checkouts, ...headCommitters]))
	})
