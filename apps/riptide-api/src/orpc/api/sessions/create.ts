import { sessions } from '@humanlayer/db/tables/sessions'
import { ORPCError } from '@orpc/server'

import { getTxId } from '../../../db/get-tx-id'
import { validateHostOwnership } from '../../../db/host-auth'
import { checkTaskWritePermission } from '../../../db/task-auth'
import { upsertTaskUserSettingsForSession } from '../../../db/upsert-task-user-settings-for-session'
import { tryEnsureSessionStreamHydrated } from '../../../effects/services/durable-streams/streams'
import logger from '../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

/**
 * Create a new draft session
 *
 * Authorization:
 * - If taskId is provided, user must have write permission on the task
 * - Session inherits resource_owner_user_id from task (or creating user if no task/task has no owner)
 */
export const createSessionProcedure = apiBaseOrgRequired.sessions.create
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const {
			id,
			taskId,
			title,
			prompt,
			workingDirectory,
			hostId,
			codingAgent,
			provider,
			model,
			permissionsMode,
			status,
			updateTaskDefaultWorkingDirectory,
		} = input
		const organizationId = context.auth.organizationId
		const { services } = context
		const { db } = services

		try {
			const txResult = await db.transaction(async (tx) => {
				// If taskId is provided, verify write permission and get task's resource_owner
				let resourceOwnerUserId = context.auth.userId
				if (taskId) {
					const taskCheck = await checkTaskWritePermission(tx, taskId, context.auth.userId, organizationId)
					if (!taskCheck.ok) {
						if (taskCheck.reason === 'not_found') {
							throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
						}
						throw errors.FORBIDDEN({ data: { message: 'Write permission required on task' } })
					}
					// Inherit resource_owner from task, fallback to creating user if task has no owner
					resourceOwnerUserId = taskCheck.task.resource_owner_user_id ?? context.auth.userId
				}

				// Validate host ownership when hostId is provided
				if (hostId) {
					const hostValid = await validateHostOwnership(tx, hostId, context.auth.userId, organizationId)
					if (!hostValid) {
						throw errors.FORBIDDEN({ data: { message: 'Host not found or not owned by user' } })
					}
				}

				const sessionValues: typeof sessions.$inferInsert = {
					task_id: taskId ?? null,
					status,
					title,
					organization_id: organizationId,
					prompt,
					coding_agent: codingAgent,
					provider,
					model,
					working_directory: workingDirectory.trim(),
					host_id: hostId ?? '',
					permissions_mode: permissionsMode,
					created_by: context.auth.userId,
					resource_owner_user_id: resourceOwnerUserId,
					num_events: 0,
				}
				if (id) sessionValues.id = id
				const [result] = await tx.insert(sessions).values(sessionValues).returning()

				if (!result) {
					throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Unable to insert session' } })
				}

				// Implicit per-user override upsert for non-owner session creation in a shared task
				if (taskId && resourceOwnerUserId !== context.auth.userId) {
					await upsertTaskUserSettingsForSession(tx, {
						taskId,
						userId: context.auth.userId,
						organizationId,
						workingDirectory: workingDirectory.trim(),
						hostId: hostId ?? null,
						updateExistingDirectory: updateTaskDefaultWorkingDirectory ?? false,
					})
				}

				const txid = await getTxId(tx)

				return {
					session: result,
					txid,
				}
			})

			await tryEnsureSessionStreamHydrated(
				txResult.session.id,
				db,
				{ organizationId, userId: context.auth.userId },
				'create',
			)

			return {
				transactionId: txResult.txid,
				session: txResult.session,
			}
		} catch (error: unknown) {
			if (error instanceof ORPCError) {
				throw error
			}
			logger.error(error, 'Failed to create draft session')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})
