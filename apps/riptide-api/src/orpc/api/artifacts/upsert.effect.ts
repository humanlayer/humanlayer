import { checkIfDesignDocHasOpenQuestions } from '@humanlayer/ai/design-doc-open-questions'
import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, sql } from 'drizzle-orm'
import { Clock, Effect } from 'effect'
import { hash } from 'ohash'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import type { PostgresTransaction } from '../../../effects/services/postgres/postgres-db.service'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { SlackService } from '../../../effects/services/slack/slack.service'
import { Sentry } from '../../../instrument'
import { MAX_TEXT_CONTENT_BYTES } from '../../../lib/constants'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import logger from '../../../logger'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

const DESIGN_DOCUMENT_TYPES: readonly string[] = ['design-discussion', 'design-prd', 'design-tdd']

export const upsertApiArtifactProcedure = effectOrpcBaseOrganizationRequired.artifacts.upsert
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const slack = yield* SlackService
		const { organizationId, userId } = context.auth
		const { taskId, content, frontmatter, sessionId, operationType, operationContents } = input

		const normalizedFileName = normalizeSubpath(input.fileName)
		const contentSizeBytes = Buffer.byteLength(content, 'utf8')

		if (contentSizeBytes > MAX_TEXT_CONTENT_BYTES) {
			return yield* Effect.fail(errors.BAD_REQUEST({ data: { message: 'Content exceeds maximum size' } }))
		}

		const contentHash = hash(content)

		const upsertResult = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					const task = yield* requireTaskEditPermission(tx, { taskId, userId, organizationId })

					const taskSlug = task.slug ?? ''
					const resourceOwnerUserId = task.resource_owner_user_id ?? userId

					const [existingArtifact] = yield* tx.query(
						tx.client
							.select()
							.from(artifacts)
							.where(and(eq(artifacts.task_id, taskId), eq(artifacts.file_name, normalizedFileName)))
							.limit(1),
					)

					let artifactId: string
					let wasCreated = false
					let newVersionNumber: number | undefined

					if (existingArtifact) {
						artifactId = existingArtifact.id
						const contentChanged = existingArtifact.content_hash !== contentHash

						if (contentChanged) {
							newVersionNumber = yield* createArtifactVersion(tx, {
								artifactId,
								taskId,
								taskSlug,
								resourceOwnerUserId,
								organizationId,
								previousContent: existingArtifact.content ?? '',
								previousContentHash: existingArtifact.content_hash ?? '',
								createdByUserId: userId,
							})
						}

						yield* tx.query(
							tx.client
								.update(artifacts)
								.set({
									content,
									content_hash: contentHash,
									task_slug: taskSlug,
									frontmatter: frontmatter ?? {},
									last_updated_at: BigInt(yield* Clock.currentTimeMillis),
									is_deleted: false,
									storage_type: 'postgres',
									s3_key: null,
									content_type: null,
									file_size_bytes: null,
								})
								.where(eq(artifacts.id, artifactId)),
						)
					} else {
						const artifactValues: typeof artifacts.$inferInsert = {
							task_id: taskId,
							task_slug: taskSlug,
							file_name: normalizedFileName,
							content,
							content_hash: contentHash,
							frontmatter: frontmatter ?? {},
							resource_owner_user_id: resourceOwnerUserId,
							organization_id: organizationId,
							created_by: userId,
						}
						if (input.id) artifactValues.id = input.id

						const [insertedArtifact] = yield* tx.query(
							tx.client.insert(artifacts).values(artifactValues).returning(),
						)
						if (!insertedArtifact) throw new Error('insert returned no row')
						artifactId = insertedArtifact.id
						wasCreated = true
					}

					if (operationType && operationContents) {
						yield* tx.query(
							tx.client.insert(artifactOperationsLog).values({
								artifact_id: artifactId,
								session_id: sessionId ?? null,
								task_id: taskId,
								task_slug: taskSlug,
								resource_owner_user_id: resourceOwnerUserId,
								organization_id: organizationId,
								created_by: userId,
								operation_type: operationType,
								operation_contents: operationContents,
								version_created: newVersionNumber !== undefined,
							}),
						)
					}

					const transactionId = yield* getTransactionId(tx)
					return {
						artifactId,
						transactionId,
						created: wasCreated,
						versionNumber: newVersionNumber,
						taskSlug,
						resourceOwnerUserId,
					}
				}),
			)
			.pipe(
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					TaskPermissionDeniedError: () =>
						Effect.fail(
							errors.FORBIDDEN({
								data: { message: 'Edit permission required to create or update artifacts' },
							}),
						),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		const documentType = frontmatter?.type as string | undefined
		if (upsertResult.created) {
			yield* slack
				.dispatchArtifactEvent({
					organizationId,
					taskId,
					taskSlug: upsertResult.taskSlug || null,
					artifactId: upsertResult.artifactId,
					fileName: normalizedFileName,
					artifactType: documentType,
					resourceOwnerUserId: upsertResult.resourceOwnerUserId,
					actorUserId: userId,
					created: true,
					versionNumber: upsertResult.versionNumber,
				})
				.pipe(
					Effect.catchCause((cause) =>
						Effect.sync(() => {
							Sentry.captureException(cause, {
								tags: { error_type: 'slack_dispatch_defect' },
								extra: { organizationId, taskId, artifactId: upsertResult.artifactId },
							})
						}),
					),
					Effect.forkDetach({ startImmediately: true }),
				)
		}

		const publicUpsertResult = {
			artifactId: upsertResult.artifactId,
			transactionId: upsertResult.transactionId,
			created: upsertResult.created,
			versionNumber: upsertResult.versionNumber,
		}
		if (!documentType || !DESIGN_DOCUMENT_TYPES.includes(documentType) || !sessionId) {
			return publicUpsertResult
		}

		const matchingDesignSessions = yield* postgres
			.query(
				postgres.client
					.select({ id: sessions.id })
					.from(sessions)
					.where(
						and(
							eq(sessions.id, sessionId),
							eq(sessions.organization_id, organizationId),
							sql`(
								${sessions.labels} @> '[{"name":"rpi:design"}]'::jsonb
								OR ${sessions.labels} @> '[{"name":"rpi:design-prd"}]'::jsonb
								OR ${sessions.labels} @> '[{"name":"rpi:design-tdd"}]'::jsonb
							)`,
						),
					)
					.limit(1),
			)
			.pipe(Effect.catchTags({ PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors) }))

		if (matchingDesignSessions.length === 0) {
			return publicUpsertResult
		}

		return yield* Effect.tryPromise(() => Effect.runPromise(checkIfDesignDocHasOpenQuestions(content))).pipe(
			Effect.map((questionAnalysis) => ({
				...publicUpsertResult,
				designQuestionsResolved: questionAnalysis.numOpenQuestions === 0,
			})),
			Effect.catch((error) => {
				logger.error({ error, artifactId: upsertResult.artifactId }, 'Design question inference failed')
				return Effect.succeed(publicUpsertResult)
			}),
		)
	})

/**
 * Creates a version snapshot of an artifact before updating it.
 * Returns the new version number.
 */
function createArtifactVersion(
	tx: PostgresTransaction,
	params: {
		artifactId: string
		taskId: string
		taskSlug: string
		resourceOwnerUserId: string
		organizationId: string
		previousContent: string
		previousContentHash: string
		createdByUserId: string
	},
) {
	return Effect.gen(function* () {
		const [maxVersionRow] = yield* tx.query(
			tx.client
				.select({ maxVersion: sql<number>`MAX(version_number)` })
				.from(artifactVersions)
				.where(eq(artifactVersions.artifact_id, params.artifactId)),
		)
		const nextVersionNumber = (maxVersionRow?.maxVersion ?? 0) + 1

		yield* tx.query(
			tx.client.insert(artifactVersions).values({
				artifact_id: params.artifactId,
				task_id: params.taskId,
				task_slug: params.taskSlug,
				resource_owner_user_id: params.resourceOwnerUserId,
				organization_id: params.organizationId,
				content: params.previousContent,
				content_hash: params.previousContentHash,
				created_by: params.createdByUserId,
				version_number: nextVersionNumber,
			}),
		)

		return nextVersionNumber
	})
}
