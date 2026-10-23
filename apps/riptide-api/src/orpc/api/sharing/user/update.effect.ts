import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskReadPermissionForUpdate } from '../../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

/**
 * Update user sharing for a task.
 * - permissionLevel: 'read' or 'edit' = share with user (upsert ACL)
 * - permissionLevel: null = unshare (delete ACL)
 *
 * Authorization: Only task owner can manage user permissions.
 * - 404 NOT_FOUND if task doesn't exist or user can't view it
 * - 403 FORBIDDEN if user can view but is not the owner
 */
export const updateUserSharingProcedure = effectOrpcBaseOrganizationRequired.sharing.user.update.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { taskId, subjectUserId, permissionLevel } = input
	const { userId, organizationId } = context.auth

	const result = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				// Read permission missing maps to NOT_FOUND to avoid leaking existence
				const task = yield* requireTaskReadPermissionForUpdate(tx, { taskId, userId, organizationId })

				if (task.resource_owner_user_id !== userId) {
					return yield* Effect.fail(
						errors.FORBIDDEN({ data: { message: 'Only task owner can manage user permissions' } }),
					)
				}

				const transactionId = yield* getTransactionId(tx)

				if (permissionLevel !== null) {
					const [acl] = yield* tx.query(
						tx.client
							.insert(taskUserAcl)
							.values({
								task_id: taskId,
								subject_user_id: subjectUserId,
								organization_id: organizationId,
								resource_owner_user_id: task.resource_owner_user_id,
								permission_level: permissionLevel,
								granted_by: userId,
							})
							.onConflictDoUpdate({
								target: [taskUserAcl.organization_id, taskUserAcl.subject_user_id, taskUserAcl.task_id],
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

				// permissionLevel === null → remove ACL
				yield* tx.query(
					tx.client
						.delete(taskUserAcl)
						.where(
							and(
								eq(taskUserAcl.task_id, taskId),
								eq(taskUserAcl.subject_user_id, subjectUserId),
								eq(taskUserAcl.organization_id, organizationId),
							),
						),
				)

				return { transactionId, acl: null }
			}),
		)
		.pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				// Read permission missing maps to NOT_FOUND to avoid leaking existence
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	yield* Effect.logInfo('User sharing updated').pipe(
		Effect.annotateLogs({ taskId, subjectUserId, permissionLevel, userId }),
	)

	return result
})
