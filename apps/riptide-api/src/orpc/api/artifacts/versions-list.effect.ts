import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import * as Sentry from '@sentry/node'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const listArtifactVersionsProcedure = effectOrpcBaseOrganizationRequired.artifacts.versions.list.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth

		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const [artifact] = yield* tx.query(
						tx.client
							.select({
								taskId: artifacts.task_id,
								contentHash: artifacts.content_hash,
								lastUpdatedAt: artifacts.last_updated_at,
							})
							.from(artifacts)
							.where(
								and(
									eq(artifacts.id, input.artifactId),
									eq(artifacts.organization_id, organizationId),
									eq(artifacts.is_deleted, false),
								),
							)
							.limit(1),
					)

					if (!artifact?.taskId) {
						return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
					}

					yield* requireTaskReadPermission(tx, { taskId: artifact.taskId, userId, organizationId })

					const archivedRows = yield* tx.query(
						tx.client
							.select({
								id: artifactVersions.id,
								versionNumber: artifactVersions.version_number,
								contentHash: artifactVersions.content_hash,
								createdAt: artifactVersions.created_at,
								createdBy: artifactVersions.created_by,
							})
							.from(artifactVersions)
							.where(
								and(
									eq(artifactVersions.artifact_id, input.artifactId),
									eq(artifactVersions.organization_id, organizationId),
								),
							)
							.orderBy(desc(artifactVersions.version_number)),
					)

					return {
						latest: {
							kind: 'latest' as const,
							id: 'latest' as const,
							label: 'Latest' as const,
							contentHash: artifact.contentHash,
							createdAt: Number(artifact.lastUpdatedAt),
						},
						archived: archivedRows.map((row) => ({
							kind: 'archived' as const,
							id: row.id,
							label: `Version ${row.versionNumber}`,
							versionNumber: row.versionNumber,
							contentHash: row.contentHash,
							createdAt: Number(row.createdAt),
							createdBy: row.createdBy,
						})),
					}
				}),
			)
			.pipe(
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } })),
					PostgresDbQueryError: (error) =>
						Effect.logError('Failed to list artifact versions', error).pipe(
							Effect.annotateLogs({ artifactId: input.artifactId, organizationId }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(error, {
										tags: { operation: 'artifact_versions.list' },
										extra: { artifactId: input.artifactId, organizationId },
									}),
								),
							),
							Effect.andThen(mapPostgresErrorToResponse(error, errors)),
						),
					PostgresDbTransactionError: (error) =>
						Effect.logError('Failed to list artifact versions transaction', error).pipe(
							Effect.annotateLogs({ artifactId: input.artifactId, organizationId }),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(error, {
										tags: { operation: 'artifact_versions.list' },
										extra: { artifactId: input.artifactId, organizationId },
									}),
								),
							),
							Effect.andThen(mapPostgresErrorToResponse(error, errors)),
						),
				}),
			)
	},
)
