import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, ne } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { canWriteTaskForSession } from '../../../../db/task-auth'
import { parseGitHubRemoteUrl } from '../../../../effects/services/github/repo-name'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../../effect-base'

/**
 * A repository the snapshot omits keeps its rows: the daemon may simply have failed to probe that
 * checkout this cycle, and a failed probe must not read as abandoned. repo_full_name is parsed
 * here and never sent, so a report cannot claim a repository the checkout does not point at.
 */
export const reportSessionRepositoriesProcedure = effectOrpcDaemonBase.sessions.repositories.report
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId, hostId } = context.auth

		// Two entries for one root contradict each other; the last one reported wins.
		const snapshot = [...new Map(input.repositories.map((repo) => [repo.localPath, repo])).values()]

		const recorded = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [session] = yield* tx.query(
						tx.client
							.select({
								id: sessions.id,
								task_id: sessions.task_id,
								created_by: sessions.created_by,
								resource_owner_user_id: sessions.resource_owner_user_id,
								host_id: sessions.host_id,
							})
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.limit(1)
							.for('no key update'),
					)

					if (!session) {
						return yield* Effect.fail(errors.NOT_FOUND())
					}

					if (session.host_id !== hostId || session.created_by !== userId) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					// SAFETY: canWriteTaskForSession only runs selects; PgTransaction is
					// assignable from the transaction client (same seam as
					// effects/services/postgres/helpers.ts).
					const canWrite = yield* tx.run(() =>
						canWriteTaskForSession(tx.client, session, userId, organizationId),
					)
					if (!canWrite) {
						return yield* Effect.fail(errors.FORBIDDEN())
					}

					const now = BigInt(yield* Clock.currentTimeMillis)

					for (const repo of snapshot) {
						const branch = repo.branch ?? null
						const remoteUrl = repo.remoteUrl ?? null
						const repoFullName = remoteUrl ? parseGitHubRemoteUrl(remoteUrl) : null

						const [row] = yield* tx.query(
							tx.client
								.insert(sessionRepositories)
								.values({
									organization_id: organizationId,
									session_id: session.id,
									task_id: session.task_id,
									host_id: hostId,
									local_path: repo.localPath,
									remote_url: remoteUrl,
									repo_full_name: repoFullName,
									branch,
									is_head: true,
									first_seen_at: now,
									last_seen_at: now,
								})
								.onConflictDoUpdate({
									target: [
										sessionRepositories.organization_id,
										sessionRepositories.session_id,
										sessionRepositories.local_path,
										sessionRepositories.branch,
									],
									set: {
										task_id: session.task_id,
										host_id: hostId,
										remote_url: remoteUrl,
										repo_full_name: repoFullName,
										is_head: true,
										last_seen_at: now,
										updated_at: now,
									},
								})
								.returning({ id: sessionRepositories.id }),
						)

						if (!row) {
							return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())
						}

						yield* tx.query(
							tx.client
								.update(sessionRepositories)
								.set({ is_head: false, updated_at: now })
								.where(
									and(
										eq(sessionRepositories.organization_id, organizationId),
										eq(sessionRepositories.session_id, session.id),
										eq(sessionRepositories.local_path, repo.localPath),
										ne(sessionRepositories.id, row.id),
										eq(sessionRepositories.is_head, true),
									),
								),
						)
					}

					return snapshot.length
				}),
			)
			.pipe(
				Effect.tap((count) =>
					Effect.logInfo('Session repositories reported').pipe(
						Effect.annotateLogs({
							organizationId,
							sessionId: input.sessionId,
							hostId,
							recorded: count,
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

		return { recorded }
	})
