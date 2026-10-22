import { approvals } from '@humanlayer/db/tables/approvals'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq } from 'drizzle-orm'

import { getTxId } from '../../../db/get-tx-id'
import { canWriteTaskForSession } from '../../../db/task-auth'
import { stripNullBytes } from '../../../lib/strip-null-bytes'
import logger from '../../../logger'
import { daemonBase, requiresDaemonBillingMiddleware } from '../../base'

/**
 * Create a pending approval for a tool call.
 * Also updates session status to 'needs_approval'.
 *
 * Authorization:
 * - Daemon must be running this session (host_id check)
 * - User must have write permission on session (via task ACL or session ownership)
 */
export const createApprovalProcedure = daemonBase.approvals.create
	.use(requiresDaemonBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { sessionId, toolName, toolUseId, agentId } = input
		// Postgres JSONB rejects U+0000, which agents emit in tool inputs that mention null
		// bytes (see lib/strip-null-bytes.ts).
		const toolInput = stripNullBytes(input.toolInput)
		const suggestions = stripNullBytes(input.suggestions)
		const { userId, organizationId, hostId } = context.auth
		const { services } = context
		const { db } = services

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Fetch session with auth-relevant fields
				const [session] = await tx
					.select({
						id: sessions.id,
						task_id: sessions.task_id,
						created_by: sessions.created_by,
						resource_owner_user_id: sessions.resource_owner_user_id,
						host_id: sessions.host_id,
					})
					.from(sessions)
					.where(and(eq(sessions.id, sessionId), eq(sessions.organization_id, organizationId)))
					.limit(1)
					.for('no key update')

				if (!session) {
					throw errors.NOT_FOUND()
				}

				// 2. Verify daemon is running this session (host_id check)
				if (session.host_id !== hostId || session.created_by !== userId) {
					throw errors.FORBIDDEN()
				}

				// 3. Use task auth helper for permission check
				const canWrite = await canWriteTaskForSession(tx, session, userId, organizationId)
				if (!canWrite) {
					throw errors.FORBIDDEN()
				}

				// 2. Create the approval record using auth context values
				const [approval] = await tx
					.insert(approvals)
					.values({
						session_id: sessionId,
						organization_id: organizationId,
						user_id: userId,
						host_id: hostId,
						resource_owner_user_id: session.resource_owner_user_id,
						task_id: session.task_id,
						tool_name: toolName,
						tool_input: toolInput,
						tool_use_id: toolUseId,
						agent_id: agentId,
						suggestions: suggestions,
						status: 'pending',
					})
					.returning({ id: approvals.id })

				if (!approval) {
					throw new Error('Failed to create approval')
				}

				// 3. Update session status to needs_approval
				await tx
					.update(sessions)
					.set({
						status: 'needs_approval',
						last_activity_at: BigInt(Date.now()),
					})
					.where(eq(sessions.id, sessionId))

				const txid = await getTxId(tx)
				return { approvalId: approval.id, txid }
			})

			return {
				approvalId: txResult.approvalId,
				transactionId: txResult.txid,
			}
		} catch (error: unknown) {
			logger.error(error, 'Failed to create approval')
			throw error
		}
	})
