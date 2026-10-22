import { commits } from '@humanlayer/db/tables/commits'
import { sessions } from '@humanlayer/db/tables/sessions'
import type { ObservedCommitSchema } from '@humanlayer/riptide-api-contract/daemon/commits/record-observed'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'
import type z from 'zod/v4'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

type ObservedCommit = z.infer<typeof ObservedCommitSchema>

/** The org-scoped session fields denormalized onto an attributed commit row. */
type AttributionSession = {
	id: string
	task_id: string | null
	resource_owner_user_id: string
	coding_agent: CodingAgent | null
}

/**
 * The attribution columns for one observed commit — the single place that decides an
 * attributed vs unattributed row, pinning the ledger invariant: a row carries a
 * non-'human' tier iff it carries a session resolved IN THIS ORG. A commit whose claimed
 * session didn't resolve here (the trailer rides world-readable commit messages, so a
 * public/forked repo carries other orgs' session URLs; a session row may also have been
 * deleted since) lands as an unattributed 'human' row owned by the daemon-token user —
 * never as a 'confirmed' row pointing at a session this org cannot see.
 */
function attributionColumns(
	commit: ObservedCommit,
	sessionsById: Map<string, AttributionSession>,
	daemonUserId: string,
) {
	const session = commit.attributedSessionId !== undefined ? sessionsById.get(commit.attributedSessionId) : undefined
	if (session === undefined) {
		return {
			session_id: null,
			task_id: null,
			resource_owner_user_id: daemonUserId,
			coding_agent: null,
			attribution_method: 'human' as const,
			ai_confidence: 0,
			ai_attributed_lines: 0,
		}
	}
	return {
		session_id: session.id,
		task_id: session.task_id,
		resource_owner_user_id: session.resource_owner_user_id,
		coding_agent: session.coding_agent,
		attribution_method: commit.attributionMethod,
		ai_confidence: commit.aiConfidence,
		ai_attributed_lines: commit.aiAttributedLines,
	}
}

/**
 * Record every commit the daemon's HEAD-watch observes in a watched repo — agent
 * OR human — into the commit ledger. Each commit arrives already tagged daemon-side
 * with an attribution tier: 'confirmed' (session trailer), 'inferred' (line-match)
 * or 'human' (no match). Host-scoped: attribution is per-commit, so unlike
 * sessions.commits.record there is no top-level sessionId — a batch mixes commits
 * attributed to a session with human commits that belong to none.
 *
 * For an attributed commit (attributedSessionId set) the session's owner/task/agent
 * are denormalized onto the row after verifying the session belongs to the auth org.
 * A human commit (no attributedSessionId) is owned by the daemon-token user, with
 * null session/task/agent.
 *
 * An attributed commit whose session is NOT resolvable in the auth org is downgraded
 * to an unattributed 'human' row rather than failing the batch: the session trailer
 * rides world-readable commit messages, so a public/forked repo legitimately carries
 * other orgs' session URLs, and a session row may have been deleted since. Rejecting
 * the batch would wedge the daemon's HEAD-watch forever — the watermark only advances
 * after a successful record, so the same batch would be retried on every scan.
 *
 * Idempotent on (organization_id, commit_sha): replays insert nothing for SHAs
 * already recorded and return only the newly-inserted count. Rows are insert-only.
 */
export const recordObservedCommitsProcedure = effectOrpcDaemonBase.commits.recordObserved
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		const result = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// 1. Resolve the sessions referenced by attributed commits in one query,
					// scoped to the auth org. Human commits carry no session and are skipped here.
					const attributedSessionIds = [
						...new Set(
							input.commits
								.map((commit) => commit.attributedSessionId)
								.filter((id): id is string => id !== undefined),
						),
					]

					const sessionRows = attributedSessionIds.length
						? yield* tx.query(
								tx.client
									.select({
										id: sessions.id,
										task_id: sessions.task_id,
										resource_owner_user_id: sessions.resource_owner_user_id,
										coding_agent: sessions.coding_agent,
										organization_id: sessions.organization_id,
									})
									.from(sessions)
									.where(
										and(
											inArray(sessions.id, attributedSessionIds),
											eq(sessions.organization_id, organizationId),
											eq(sessions.created_by, userId),
											eq(sessions.host_id, hostId),
										),
									)
									.for('no key update'),
							)
						: []

					const sessionById = new Map(sessionRows.map((s) => [s.id, s]))

					// A claimed session that didn't resolve here means the commit lands
					// unattributed (see attributionColumns) — never a batch failure, which
					// would wedge the caller's watermark loop. Counted for observability.
					const downgraded = input.commits.filter(
						(commit) =>
							commit.attributedSessionId !== undefined && !sessionById.has(commit.attributedSessionId),
					).length

					// 2. Idempotent batch insert, one row per observed SHA
					const inserted = yield* tx.query(
						tx.client
							.insert(commits)
							.values(
								input.commits.map((commit) => {
									return {
										organization_id: organizationId,
										...attributionColumns(commit, sessionById, userId),
										commit_sha: commit.sha,
										parent_shas: commit.parentShas,
										branch: commit.branch,
										repo_remote_url: commit.repoRemoteUrl,
										// Lowercased server-side to match pull_requests.repo_full_name (also
										// lowercased in the PR upsert); GitHub owner/repo is case-insensitive,
										// so the documented commits<->pull_requests join must agree on casing.
										repo_full_name: commit.repoFullName?.toLowerCase(),
										repo_directory: commit.repoDirectory,
										subject: commit.subject,
										body: commit.body,
										author_name: commit.authorName,
										author_email: commit.authorEmail,
										authored_at:
											commit.authoredAt !== undefined ? BigInt(commit.authoredAt) : undefined,
										committed_at: BigInt(commit.committedAt),
										additions: commit.additions,
										deletions: commit.deletions,
										files_changed: commit.filesChanged,
										file_stats: commit.fileStats,
										co_authored_by_agent: commit.coAuthoredByAgent,
										capture_algorithm_version: commit.captureAlgorithmVersion,
										change_id: commit.changeId,
										is_primary_branch: commit.isPrimaryBranch,
										author_matches_daemon_user: commit.authorMatchesDaemonUser,
										// The matcher that produced the (possibly downgraded) verdict,
										// versioned independently of capture.
										attribution_algorithm_version: commit.attributionAlgorithmVersion,
									}
								}),
							)
							.onConflictDoNothing({ target: [commits.organization_id, commits.commit_sha] })
							.returning({ id: commits.id }),
					)

					return { recorded: inserted.length, downgraded }
				}),
			)
			.pipe(
				Effect.tap(({ downgraded }) =>
					downgraded > 0
						? Effect.logWarning(
								'Observed commits referenced unresolvable sessions; downgraded to human',
							).pipe(Effect.annotateLogs({ organizationId, downgraded }))
						: Effect.void,
				),
				Effect.tap((result) =>
					Effect.logInfo('Observed commits recorded').pipe(
						Effect.annotateLogs({
							organizationId,
							observed: input.commits.length,
							recorded: result.recorded,
						}),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		// `downgraded` is observability-only (logged above) — the contract returns the count.
		return { recorded: result.recorded }
	})
