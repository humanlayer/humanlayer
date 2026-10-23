import { commits } from '@humanlayer/db/tables/commits'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { canWriteTaskForSession } from '../../../../db/task-auth'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import {
	effectOrpcDaemonBase,
	isExpectedClientError,
	requiresDaemonBillingEffectMiddleware,
} from '../../../effect-base'

/**
 * Record commits observed during a run's watermark scan (baseline HEAD at run
 * start -> HEAD at run end).
 *
 * Idempotent on (organization_id, commit_sha): the daemon's oRPC client
 * retries with an identical payload, so replays insert nothing for SHAs
 * already recorded (first-writer session attribution wins, including across
 * sessions in the same org) and return only the newly-inserted count. Rows
 * are insert-only — this procedure never updates.
 *
 * Authorization matches usage/record: daemon must be running the session
 * (host_id), and the user must have write permission via the task ACL.
 *
 * No transactionId in the output — the table is not Electric-synced.
 */
export const recordCommitsProcedure = effectOrpcDaemonBase.sessions.commits.record
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		const recorded = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// 1. Fetch session with auth-relevant fields (+ denormalization fields)
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								task_id: sessions.task_id,
								created_by: sessions.created_by,
								resource_owner_user_id: sessions.resource_owner_user_id,
								host_id: sessions.host_id,
								coding_agent: sessions.coding_agent,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						return yield* Effect.fail(errors.NOT_FOUND())
					}

					// 2. Verify daemon is running this session (host_id check)
					if (session.host_id !== hostId || session.created_by !== userId) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// 3. Task ACL / ownership
					const canWrite = yield* tx.run(() =>
						canWriteTaskForSession(tx.client, session, userId, organizationId),
					)
					if (!canWrite) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// 4. Idempotent batch insert, one row per observed SHA
					const inserted = yield* tx.query(
						tx.client
							.insert(commits)
							.values(
								input.commits.map((commit) => ({
									organization_id: organizationId,
									session_id: input.sessionId,
									task_id: session.task_id,
									resource_owner_user_id: session.resource_owner_user_id,
									coding_agent: session.coding_agent,
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
								})),
							)
							.onConflictDoNothing({ target: [commits.organization_id, commits.commit_sha] })
							.returning({ id: commits.id }),
					)

					return inserted.length
				}),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo('Commits recorded').pipe(
						Effect.annotateLogs({
							organizationId,
							sessionId: input.sessionId,
							observed: input.commits.length,
							recorded: result,
						}),
					),
				),
				// Capture the RAW failure (a PostgresDbQueryError with its kind/code/retryable)
				// before catchTags flattens it into a bare 5xx — but apply the base's own 4xx
				// filter, so the NOT_FOUND/FORBIDDEN raised above stay out of Sentry. A daemon
				// that lost the session (host handoff, deleted session) retries the identical
				// batch, so an unfiltered tap turns every dropped batch into a Sentry burst.
				Effect.tapError((e) =>
					isExpectedClientError(e)
						? Effect.void
						: Effect.logError(e).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(e)))),
				),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { recorded }
	})
