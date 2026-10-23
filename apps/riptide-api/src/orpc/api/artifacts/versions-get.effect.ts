import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import * as Sentry from '@sentry/node'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getArtifactVersionProcedure = effectOrpcBaseOrganizationRequired.artifacts.versions.get.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { userId, organizationId } = context.auth

	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [artifact] = yield* tx.query(
					tx.client
						.select({ taskId: artifacts.task_id })
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

				const [version] = yield* tx.query(
					tx.client
						.select({
							id: artifactVersions.id,
							versionNumber: artifactVersions.version_number,
							content: artifactVersions.content,
							contentHash: artifactVersions.content_hash,
							createdAt: artifactVersions.created_at,
							createdBy: artifactVersions.created_by,
						})
						.from(artifactVersions)
						.where(
							and(
								eq(artifactVersions.id, input.versionId),
								eq(artifactVersions.artifact_id, input.artifactId),
								eq(artifactVersions.organization_id, organizationId),
							),
						)
						.limit(1),
				)

				if (!version) {
					return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact version not found' } }))
				}

				return {
					kind: 'archived' as const,
					id: version.id,
					label: `Version ${version.versionNumber}`,
					versionNumber: version.versionNumber,
					content: version.content,
					contentHash: version.contentHash,
					createdAt: Number(version.createdAt),
					createdBy: version.createdBy,
				}
			}),
		)
		.pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } })),
				PostgresDbQueryError: (error) =>
					Effect.logError('Failed to get artifact version', error).pipe(
						Effect.annotateLogs({ artifactId: input.artifactId, organizationId }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { operation: 'artifact_versions.get' },
									extra: { artifactId: input.artifactId, organizationId },
								}),
							),
						),
						Effect.andThen(mapPostgresErrorToResponse(error, errors)),
					),
				PostgresDbTransactionError: (error) =>
					Effect.logError('Failed to get artifact version transaction', error).pipe(
						Effect.annotateLogs({ artifactId: input.artifactId, organizationId }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { operation: 'artifact_versions.get' },
									extra: { artifactId: input.artifactId, organizationId },
								}),
							),
						),
						Effect.andThen(mapPostgresErrorToResponse(error, errors)),
					),
			}),
		)
})
