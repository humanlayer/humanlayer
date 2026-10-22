import { commitWatchWatermarks } from '@humanlayer/db/tables/commit-watch-watermarks'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

/**
 * Read the daemon's commit HEAD-watch resume watermarks for a set of repo
 * directories, scoped to the calling host (context.auth.hostId) and org. Returns
 * one entry per requested directory — lastSeenSha is null when no scan has landed
 * for that repo yet (or no row exists), so the caller can treat absent and
 * never-scanned identically.
 */
export const getCommitWatermarksProcedure = effectOrpcDaemonBase.commits.watermark.get
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { organizationId, hostId } = context.auth

		const rows = yield* postgres
			.query(
				postgres.client
					.select({
						repo_directory: commitWatchWatermarks.repo_directory,
						last_seen_sha: commitWatchWatermarks.last_seen_sha,
					})
					.from(commitWatchWatermarks)
					.where(
						and(
							eq(commitWatchWatermarks.host_id, hostId),
							eq(commitWatchWatermarks.organization_id, organizationId),
							inArray(commitWatchWatermarks.repo_directory, input.repoDirectories),
						),
					),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		const shaByDir = new Map(rows.map((r) => [r.repo_directory, r.last_seen_sha]))

		return {
			watermarks: input.repoDirectories.map((repoDirectory) => ({
				repoDirectory,
				lastSeenSha: shaByDir.get(repoDirectory) ?? null,
			})),
		}
	})

/**
 * Advance the commit HEAD-watch watermark for one (host, repo) after a successful
 * record. Upserts on the unique (host_id, organization_id, repo_directory) index so
 * the first scan inserts and subsequent scans overwrite last_seen_sha.
 */
export const setCommitWatermarkProcedure = effectOrpcDaemonBase.commits.watermark.set
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { organizationId, hostId } = context.auth

		yield* postgres
			.query(
				postgres.client
					.insert(commitWatchWatermarks)
					.values({
						host_id: hostId,
						organization_id: organizationId,
						repo_directory: input.repoDirectory,
						last_seen_sha: input.lastSeenSha,
					})
					.onConflictDoUpdate({
						target: [
							commitWatchWatermarks.host_id,
							commitWatchWatermarks.organization_id,
							commitWatchWatermarks.repo_directory,
						],
						set: {
							last_seen_sha: input.lastSeenSha,
							updated_at: BigInt(Date.now()),
						},
					}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return { ok: true }
	})
