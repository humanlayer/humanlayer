import type { ArtifactPublicPermission } from '@humanlayer/db/artifact-public-permission'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../../effects/services/postgres/helpers'
import { requireTaskEditPermission } from '../../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

/**
 * Enable or disable shareable link for an artifact.
 * - enabled: true = generate key (if new) and enable sharing
 * - enabled: false = disable sharing (preserve key for re-enable)
 *
 * Authorization: Users with effective task edit access can manage sharing.
 * - 404 NOT_FOUND if artifact doesn't exist or wrong organization
 * - 403 FORBIDDEN if user lacks task edit access
 */
export const updateArtifactSharingProcedure = effectOrpcBaseOrganizationRequired.sharing.artifact.update.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { artifactId } = input
		const requestedPermission: ArtifactPublicPermission =
			input.permission !== undefined ? input.permission : input.enabled ? 'view' : 'off'
		const { userId, organizationId } = context.auth

		const result = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// Lock the organization so this check and the write below cannot interleave with an
					// admin turning public links off (organizations-settings-set takes FOR NO KEY UPDATE).
					// The organizations row always exists; the settings row may not.
					yield* tx.query(
						tx.client
							.select({ id: organizations.id })
							.from(organizations)
							.where(eq(organizations.id, organizationId))
							.for('share'),
					)

					// Check org-level setting before any other work
					const [orgRow] = yield* tx.query(
						tx.client
							.select()
							.from(organizationSettings)
							.where(eq(organizationSettings.organization_id, organizationId))
							.limit(1),
					)

					const sharingEnabled = orgRow?.enable_creating_publicly_shareable_links ?? true
					if (!sharingEnabled) {
						return yield* Effect.fail(
							errors.FEATURE_DISABLED_BY_ORG({
								data: { message: 'Your organization has disabled shareable links' },
							}),
						)
					}

					// Look up artifact by ID and organization
					const [artifact] = yield* tx.query(
						tx.client.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1),
					)

					if (!artifact || artifact.organization_id !== organizationId) {
						return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
					}

					if (!artifact.task_id) {
						return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } }))
					}
					yield* requireTaskEditPermission(tx, {
						taskId: artifact.task_id,
						userId,
						organizationId,
					})

					const transactionId = yield* getTransactionId(tx)
					if (requestedPermission === 'view' || requestedPermission === 'comment') {
						// Generate key if this is the first time sharing
						const shareKey = artifact.share_key ?? crypto.randomUUID()

						const [updated] = yield* tx.query(
							tx.client
								.update(artifacts)
								.set({
									share_key: shareKey,
									shared_by: userId,
									share_enabled: true,
									public_permission: requestedPermission,
								})
								.where(eq(artifacts.id, artifactId))
								.returning(),
						)

						return {
							transactionId,
							shareKey: updated?.share_key ?? shareKey,
							permission: requestedPermission,
						}
					}

					// Disable sharing — preserve key for re-enable
					yield* tx.query(
						tx.client
							.update(artifacts)
							.set({ share_enabled: false, public_permission: 'off' })
							.where(eq(artifacts.id, artifactId)),
					)

					return {
						transactionId,
						shareKey: artifact.share_key,
						permission: 'off' as const,
					}
				}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Artifact not found' } })),
					TaskPermissionDeniedError: () =>
						Effect.fail(
							errors.FORBIDDEN({ data: { message: 'Edit access is required to change sharing.' } }),
						),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		yield* Effect.logInfo('Artifact sharing updated').pipe(
			Effect.annotateLogs({ artifactId, permission: requestedPermission, userId, organizationId }),
		)

		return result
	},
)
