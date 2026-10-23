import { checkIfDesignDocHasOpenQuestions } from '@humanlayer/ai/design-doc-open-questions'
import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { hash } from 'ohash'

import { getTxId } from '../../../db/get-tx-id'
import { getTaskWithEffectivePermissions } from '../../../db/task-auth'
import { OnboardingService } from '../../../effects/services/onboarding/onboarding.service'
import { SlackService } from '../../../effects/services/slack/slack.service'
import { Sentry } from '../../../instrument'
import { MAX_TEXT_CONTENT_BYTES } from '../../../lib/constants'
import { normalizeSubpath } from '../../../lib/normalize-subpath'
import { stripNullBytes } from '../../../lib/strip-null-bytes'
import logger from '../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'

const DESIGN_QUESTION_RESOLUTION_DOCUMENT_TYPES: readonly string[] = ['design-discussion']

export const upsertArtifactProcedure = daemonBase.artifacts.upsert
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { id: clientId, taskId, fileName: rawFileName, sessionId, operationType } = input
		// Postgres rejects U+0000 in text and jsonb. Strip before hashing so content_hash
		// matches the stored content (see lib/strip-null-bytes.ts).
		const content = stripNullBytes(input.content)
		const operationContents = stripNullBytes(input.operationContents)
		const frontmatter = stripNullBytes(input.frontmatter)
		const fileName = normalizeSubpath(rawFileName)
		const { organizationId, userId } = context.auth
		const { services } = context
		const { db } = services

		// Validate content size (UTF-8 byte length) - handles multi-byte characters
		const contentBytes = Buffer.byteLength(content, 'utf8')
		if (contentBytes > MAX_TEXT_CONTENT_BYTES) {
			throw errors.BAD_REQUEST({
				data: { message: `Content size (${Math.round(contentBytes / 1024 / 1024)}MB) exceeds maximum of 10MB` },
			})
		}

		// Compute content hash server-side using ohash
		const contentHash = hash(content)

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Lookup task and verify access via ownership OR ACL with effective permissions
				const task = await getTaskWithEffectivePermissions(tx, taskId, userId, organizationId, {
					lockForUpdate: true,
				})

				if (!task) {
					throw errors.NOT_FOUND()
				}

				// 2. Require edit permission to upsert artifacts
				if (task.effectivePermission !== 'edit') {
					throw errors.FORBIDDEN({ message: 'Edit permission required to create or update artifacts' })
				}

				const taskSlug = task.slug
				const resourceOwnerUserId = task.resource_owner_user_id ?? userId

				// 3. Check if artifact exists
				const [existingArtifact] = await tx
					.select()
					.from(artifacts)
					.where(and(eq(artifacts.task_id, taskId), eq(artifacts.file_name, fileName)))
					.limit(1)

				let artifactId: string
				let created = false
				let versionNumber: number | undefined

				if (existingArtifact) {
					// UPDATE existing artifact
					artifactId = existingArtifact.id

					// Only create version if content changed
					if (existingArtifact.content_hash !== contentHash) {
						// Get next version number
						const [maxVersion] = await tx
							.select({ max: sql<number>`MAX(version_number)` })
							.from(artifactVersions)
							.where(eq(artifactVersions.artifact_id, artifactId))

						versionNumber = (maxVersion?.max ?? 0) + 1

						// Create version with previous content
						await tx.insert(artifactVersions).values({
							artifact_id: artifactId,
							task_id: taskId,
							task_slug: taskSlug,
							resource_owner_user_id: resourceOwnerUserId,
							organization_id: organizationId,
							content: existingArtifact.content ?? '',
							content_hash: existingArtifact.content_hash ?? '',
							created_by: userId,
							version_number: versionNumber,
						})
					}

					// Update artifact
					await tx
						.update(artifacts)
						.set({
							content,
							content_hash: contentHash,
							task_slug: taskSlug,
							frontmatter: frontmatter ?? {},
							last_updated_at: BigInt(Date.now()),
							is_deleted: false,
							// Reset S3 fields — text upsert always means postgres storage
							storage_type: 'postgres',
							s3_key: null,
							content_type: null,
							file_size_bytes: null,
						})
						.where(eq(artifacts.id, artifactId))
				} else {
					// CREATE new artifact (use client-provided ID if given)
					const newArtifactValues: typeof artifacts.$inferInsert = {
						task_id: taskId,
						task_slug: taskSlug,
						file_name: fileName,
						content,
						content_hash: contentHash,
						frontmatter: frontmatter ?? {},
						resource_owner_user_id: resourceOwnerUserId,
						organization_id: organizationId,
						created_by: userId,
					}
					if (clientId) newArtifactValues.id = clientId
					const [newArtifact] = await tx.insert(artifacts).values(newArtifactValues).returning()

					if (!newArtifact) throw new Error('insert returned no row')
					artifactId = newArtifact.id
					created = true
				}

				// Log operation if operationType and operationContents provided
				if (operationType && operationContents) {
					await tx.insert(artifactOperationsLog).values({
						artifact_id: artifactId,
						session_id: sessionId ?? null,
						task_id: taskId,
						task_slug: taskSlug,
						resource_owner_user_id: resourceOwnerUserId,
						organization_id: organizationId,
						created_by: userId,
						operation_type: operationType,
						operation_contents: operationContents,
						version_created: versionNumber !== undefined,
					})
				}

				const txid = await getTxId(tx)
				return { artifactId, txid, created, versionNumber, resourceOwnerUserId, taskSlug }
			})

			const output = {
				artifactId: txResult.artifactId,
				transactionId: txResult.txid,
				created: txResult.created,
				versionNumber: txResult.versionNumber,
			}

			// Fire-and-forget onboarding artifact milestones. Each method no-ops unless
			// the artifact matches its kind (design discussion >=2 versions, structure
			// outline written, or pr-description written), so detaching unconditionally
			// is safe. Failures are swallowed to Sentry and never affect the upsert.
			const onboardingSource = 'daemon.artifacts.upsert'
			const onboardingFrontmatterType = frontmatter?.type as string | undefined
			services.effectRuntime.runFork(
				Effect.gen(function* () {
					const onboarding = yield* OnboardingService
					// Day-3 (lite): design discussion iterated to >=2 versions.
					yield* onboarding.recordDesignDocIterated({
						resourceOwnerUserId: txResult.resourceOwnerUserId,
						artifactId: txResult.artifactId,
						taskId,
						fileName,
						frontmatterType: onboardingFrontmatterType,
						versionNumber: txResult.versionNumber,
					})
					// Day-7 (full): a structure-outline artifact was written.
					yield* onboarding.recordStructureOutlineCreated({
						resourceOwnerUserId: txResult.resourceOwnerUserId,
						artifactId: txResult.artifactId,
						taskId,
						fileName,
						frontmatterType: onboardingFrontmatterType,
					})
					// Day-10 (full): a pr-description artifact was written (implementation complete).
					yield* onboarding.recordImplementationComplete({
						resourceOwnerUserId: txResult.resourceOwnerUserId,
						artifactId: txResult.artifactId,
						taskId,
						fileName,
					})
				}).pipe(
					Effect.catch((err) =>
						Effect.sync(() => {
							Sentry.captureException(err, {
								tags: { error_type: 'onboarding_detached_failure', source: onboardingSource },
								extra: {
									userId: txResult.resourceOwnerUserId,
									artifactId: txResult.artifactId,
									source: onboardingSource,
								},
							})
						}),
					),
				),
			)

			if (txResult.created) {
				services.effectRuntime.runFork(
					Effect.gen(function* () {
						const slack = yield* SlackService
						yield* slack.dispatchArtifactEvent({
							organizationId,
							taskId,
							taskSlug: txResult.taskSlug,
							artifactId: txResult.artifactId,
							fileName,
							artifactType: onboardingFrontmatterType,
							resourceOwnerUserId: txResult.resourceOwnerUserId,
							actorUserId: userId,
							created: true,
							versionNumber: txResult.versionNumber,
						})
					}).pipe(
						Effect.catchCause((cause) =>
							Effect.gen(function* () {
								yield* Effect.logError('Slack daemon artifact dispatch defect', cause)
								yield* Effect.sync(() => {
									Sentry.captureException(cause, {
										tags: { error_type: 'slack_dispatch_defect' },
										extra: { organizationId, taskId, artifactId: txResult.artifactId },
									})
								})
							}),
						),
					),
				)
			}

			const documentType = frontmatter?.type as string | undefined
			if (!documentType || !DESIGN_QUESTION_RESOLUTION_DOCUMENT_TYPES.includes(documentType)) {
				return output
			}

			if (!sessionId) {
				return output
			}

			const [designSession] = await db
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
				.limit(1)

			if (!designSession) {
				return output
			}

			try {
				const questionCount = await Effect.runPromise(checkIfDesignDocHasOpenQuestions(content))
				return {
					...output,
					designQuestionsResolved: questionCount.numOpenQuestions === 0,
				}
			} catch (error) {
				logger.error({ error, artifactId: txResult.artifactId }, 'Design question inference failed')
				Sentry.addBreadcrumb({
					category: 'ai-inference',
					message: 'Design question inference failed during artifact upsert',
					level: 'error',
					data: {
						artifactId: txResult.artifactId,
						taskId,
					},
				})
				Sentry.captureException(error, {
					tags: { error_type: 'design_question_inference' },
					extra: {
						artifactId: txResult.artifactId,
						taskId,
					},
				})

				return output
			}
		} catch (error: unknown) {
			logger.error(error, 'Failed to upsert artifact')
			throw error
		}
	})
