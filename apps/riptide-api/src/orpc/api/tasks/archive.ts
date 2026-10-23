import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { ORPCError } from '@orpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { getTxId } from '../../../db/get-tx-id'
import { ACTIVE_SESSION_STATUSES } from '../../../db/session-statuses'
import { checkTaskWritePermission } from '../../../db/task-auth'
import { TaskDiffService } from '../../../effects/services/task-diff-durable-streams/task-diff-durable-streams.service'
import logger from '../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

/**
 * Archive or unarchive a task, optionally cascading to associated sessions
 *
 * Authorization: User must have write permission on task (via ownership or ACL)
 */
export const archiveTaskProcedure = apiBaseOrgRequired.tasks.archive
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { taskId, archived, cascadeToSessions } = input
		const organizationId = context.auth.organizationId
		const userId = context.auth.userId
		const { services } = context
		const { db } = services

		// Same-org admins may force-archive tasks they neither own nor hold an ACL on.
		// Reuses the JWT claim `requireAdmin` reads.
		const isAdmin = context.auth.role === 'admin' || context.auth.roles?.includes('admin')

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Verify write permission on task (via ownership or ACL)
				const taskCheck = await checkTaskWritePermission(tx, taskId, userId, organizationId)
				if (!taskCheck.ok) {
					// checkTaskWritePermission returns `not_found` for a same-org task the
					// caller can't access (no owner/ACL match), so the admin bypass cannot
					// simply catch `permission_denied` — it must independently re-load the
					// task scoped to the caller's org to confirm it exists.
					if (isAdmin) {
						const [adminTask] = await tx
							.select({ id: tasks.id })
							.from(tasks)
							.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
							.limit(1)
						if (!adminTask) {
							throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
						}
						// Same-org admin + task exists → proceed with the archive.
					} else if (taskCheck.reason === 'not_found') {
						throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
					} else {
						throw errors.FORBIDDEN({ data: { message: 'Write permission required on task' } })
					}
				}

				// 2. Update task archived status
				await tx.update(tasks).set({ archived }).where(eq(tasks.id, taskId))

				// 3. If cascading, update all associated sessions
				let affectedSessionCount = 0
				if (cascadeToSessions) {
					// If archiving, interrupt any active sessions first
					if (archived) {
						const activeSessions = await tx
							.select({ id: sessions.id })
							.from(sessions)
							.where(
								and(
									eq(sessions.task_id, taskId),
									eq(sessions.organization_id, organizationId),
									inArray(sessions.status, ACTIVE_SESSION_STATUSES),
								),
							)

						if (activeSessions.length > 0) {
							await tx
								.update(sessions)
								.set({
									status: 'interrupt_requested',
									last_activity_at: BigInt(Date.now()),
								})
								.where(
									inArray(
										sessions.id,
										activeSessions.map((s) => s.id),
									),
								)
						}
					}

					const result = await tx
						.update(sessions)
						.set({ archived })
						.where(and(eq(sessions.task_id, taskId), eq(sessions.organization_id, organizationId)))
						.returning({ id: sessions.id })

					affectedSessionCount = result.length
				}

				const txid = await getTxId(tx)

				return { txid, affectedSessionCount }
			})

			if (archived) {
				context.services.effectRuntime.runFork(
					Effect.gen(function* () {
						const taskDiff = yield* TaskDiffService
						yield* taskDiff.deleteTaskDiffStreams({ organizationId, taskId })
					}),
				)
			}

			return {
				transactionId: txResult.txid,
				success: true,
				affectedSessionCount: txResult.affectedSessionCount,
			}
		} catch (error: unknown) {
			// Re-throw oRPC errors as-is
			if (error instanceof ORPCError) {
				throw error
			}
			logger.error(error, 'Failed to archive task')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})
