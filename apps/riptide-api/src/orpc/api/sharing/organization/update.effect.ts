import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskReadPermissionForUpdate } from '../../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

/**
 * Update organization sharing for a task.
 * - permissionLevel: 'read' or 'edit' = share with org (upsert ACL)
 * - permissionLevel: null = unshare (delete ACL)
 *
 * Authorization: Only task owner can manage sharing.
 * - 404 NOT_FOUND if task doesn't exist or user can't view it
 * - 403 FORBIDDEN if user can view but is not the owner
 */
export const updateOrgSharingProcedure = effectOrpcBaseOrganizationRequired.sharing.organization.update.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { taskId, permissionLevel } = input
		const { userId, organizationId } = context.auth

		return yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// Check if task exists and user can view it (fails TaskNotFoundError otherwise)
					const task = yield* requireTaskReadPermissionForUpdate(tx, { taskId, userId, organizationId })

					// Task is viewable - now check if user is owner
					if (task.resource_owner_user_id !== userId) {
						return yield* Effect.fail(
							errors.FORBIDDEN({ data: { message: 'Only task owner can manage sharing' } }),
						)
					}

					// Always get transaction ID - even if no rows change
					const transactionId = yield* getTransactionId(tx)

					if (permissionLevel !== null) {
						// Upsert ACL - INSERT ... ON CONFLICT DO UPDATE
						const [acl] = yield* tx.query(
							tx.client
								.insert(taskOrganizationAcl)
								.values({
									organization_id: organizationId,
									task_id: taskId,
									resource_owner_user_id: task.resource_owner_user_id,
									permission_level: permissionLevel,
									granted_by: userId,
								})
								.onConflictDoUpdate({
									target: [taskOrganizationAcl.organization_id, taskOrganizationAcl.task_id],
									set: {
										permission_level: permissionLevel,
										granted_by: userId,
										resource_owner_user_id: task.resource_owner_user_id,
									},
								})
								.returning(),
						)

						return { transactionId, acl: acl ?? null }
					}

					// permissionLevel === null → unshare
					// Delete ACL if it exists
					yield* tx.query(
						tx.client
							.delete(taskOrganizationAcl)
							.where(
								and(
									eq(taskOrganizationAcl.task_id, taskId),
									eq(taskOrganizationAcl.organization_id, organizationId),
								),
							),
					)

					return { transactionId, acl: null }
				}),
			)
			.pipe(
				Effect.tap((result) =>
					Effect.logInfo('Organization sharing updated').pipe(
						Effect.annotateLogs({
							taskId,
							userId,
							organizationId,
							permissionLevel,
							transactionId: result.transactionId,
						}),
					),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	},
)
