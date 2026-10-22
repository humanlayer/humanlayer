import { isEffortSupported, isFastModeSupported } from '@humanlayer/ai/config'
import { approvals } from '@humanlayer/db/tables/approvals'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { pullRequestSessions } from '@humanlayer/db/tables/pull-request-sessions'
import { pullRequests } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { tasks } from '@humanlayer/db/tables/tasks'
import { ORPCError } from '@orpc/server'
import { and, count, eq, inArray } from 'drizzle-orm'

import { getTxId } from '../../../db/get-tx-id'
import { validateHostOwnership } from '../../../db/host-auth'
import { ACTIVE_SESSION_STATUSES } from '../../../db/session-statuses'
import { checkTaskWritePermission } from '../../../db/task-auth'
import {
	getSessionAccessControlLevelForClassicProcedure,
	hasRequiredSessionAccess,
	SessionAccessControl,
	type SessionAccessControlLevel,
} from '../../../lib/session-multiplayer-prompting-auth'
import logger from '../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

/**
 * Update a session (user-facing endpoint)
 *
 * Authorization:
 * - User must be session creator AND have edit access (via task ACL or session ownership if no task)
 * - If changing task_id to a new task, user must have write permission on target task
 * - When task changes, resource_owner_user_id is cascaded from new task to session + sub-resources
 */
export const updateSessionApiProcedure = apiBaseOrgRequired.sessions.update
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const { services } = context
		const { db } = services
		const nowMillis = Date.now()

		try {
			const txResult = await db.transaction(async (tx) => {
				if (input.taskId) {
					await tx
						.select({ id: tasks.id })
						.from(tasks)
						.where(and(eq(tasks.id, input.taskId), eq(tasks.organization_id, context.auth.organizationId)))
						.limit(1)
						.for('no key update')
				}
				// Fetch the session first to check authorization
				const [session] = await tx
					.select({
						id: sessions.id,
						task_id: sessions.task_id,
						resource_owner_user_id: sessions.resource_owner_user_id,
						created_by: sessions.created_by,
						status: sessions.status,
						coding_agent: sessions.coding_agent,
						provider: sessions.provider,
						model: sessions.model,
						effort: sessions.effort,
						fast_mode: sessions.fast_mode,
						permissions_mode: sessions.permissions_mode,
						title: sessions.title,
						prompt: sessions.prompt,
						archived: sessions.archived,
						working_directory: sessions.working_directory,
						host_id: sessions.host_id,
					})
					.from(sessions)
					.where(
						and(
							eq(sessions.id, input.sessionId),
							eq(sessions.organization_id, context.auth.organizationId),
						),
					)
					.limit(1)
					.for('no key update')

				if (!session) {
					throw errors.NOT_FOUND({ data: { message: 'Session not found' } })
				}

				const requestedValues = {
					title: input.title,
					prompt: input.prompt,
					archived: input.archived,
					permissionsMode: input.permissionsMode,
					taskId: input.taskId,
					workingDirectory: input.workingDirectory,
					hostId: input.hostId,
					codingAgent: input.codingAgent,
					provider: input.provider,
					model: input.model,
					effort: input.effort,
					fastMode: input.fastMode,
				}
				const authoritativeValues = {
					title: session.title,
					prompt: session.prompt,
					archived: session.archived,
					permissionsMode: session.permissions_mode,
					taskId: session.task_id,
					workingDirectory: session.working_directory,
					hostId: session.host_id || null,
					codingAgent: session.coding_agent,
					provider: session.provider,
					model: session.model,
					effort: session.effort,
					fastMode: session.fast_mode,
				}
				type UpdateField = keyof typeof requestedValues
				const changedFields = (Object.keys(requestedValues) as UpdateField[]).filter(
					(field) =>
						requestedValues[field] !== undefined && requestedValues[field] !== authoritativeValues[field],
				)
				const promptFields = new Set<UpdateField>(['model', 'effort', 'fastMode', 'permissionsMode'])
				const requiredAccess: SessionAccessControlLevel = changedFields.some(
					(field) => !promptFields.has(field),
				)
					? SessionAccessControl.owner
					: SessionAccessControl.prompt
				const accessLevel = await getSessionAccessControlLevelForClassicProcedure(
					tx,
					{
						organizationId: context.auth.organizationId,
						sessionId: input.sessionId,
						actorUserId: context.auth.userId,
					},
					nowMillis,
				)
				if (!hasRequiredSessionAccess(accessLevel, requiredAccess)) {
					throw errors.FORBIDDEN({ data: { message: 'Write permission required on session' } })
				}
				if (changedFields.length === 0) {
					const txid = await getTxId(tx)
					return { success: true, txid }
				}

				// These fields describe how a session will be launched and only make sense before it
				// runs. Once a session leaves draft status they are immutable.
				const draftOnlyFields = ['workingDirectory', 'codingAgent', 'provider'] as const
				if (session.status !== 'draft') {
					const attempted = draftOnlyFields.filter((field) => changedFields.includes(field))
					if (attempted.length > 0) {
						throw errors.BAD_REQUEST({
							data: {
								message: `Cannot change ${attempted.join(', ')} on a session that is not a draft`,
							},
						})
					}
				}

				// Validate effort and fastMode against capability rules when provided
				// Use the effective agent/provider/model (input.* if changing, otherwise current session values)
				const effectiveCodingAgent = input.codingAgent ?? session.coding_agent
				const effectiveProvider = input.provider ?? session.provider
				const effectiveModel = input.model ?? session.model
				if (input.effort !== undefined) {
					if (!isEffortSupported(effectiveCodingAgent, effectiveProvider, effectiveModel, input.effort)) {
						throw errors.BAD_REQUEST({
							data: {
								message: `effort=${input.effort} not supported for ${effectiveCodingAgent}/${effectiveProvider}/${effectiveModel}`,
							},
						})
					}
				}
				if (input.fastMode !== undefined) {
					if (!isFastModeSupported(effectiveCodingAgent, effectiveProvider, effectiveModel, input.fastMode)) {
						throw errors.BAD_REQUEST({
							data: {
								message: `fastMode not supported for ${effectiveCodingAgent}/${effectiveProvider}/${effectiveModel}`,
							},
						})
					}
				}

				// Build update object with only provided fields
				const updateFields: Record<string, unknown> = {}

				if (changedFields.includes('title')) {
					updateFields.title = input.title
				}
				if (changedFields.includes('prompt')) {
					updateFields.prompt = input.prompt
				}
				if (changedFields.includes('archived')) {
					updateFields.archived = input.archived
				}
				if (changedFields.includes('permissionsMode')) {
					updateFields.permissions_mode = input.permissionsMode
				}
				if (changedFields.includes('workingDirectory')) {
					updateFields.working_directory = input.workingDirectory
				}
				if (changedFields.includes('hostId')) {
					// Validate host ownership when pointing the session at a host, mirroring the
					// create/launch paths. A null/empty host_id clears the assignment (valid for drafts).
					if (input.hostId) {
						const hostValid = await validateHostOwnership(
							tx,
							input.hostId,
							context.auth.userId,
							context.auth.organizationId,
						)
						if (!hostValid) {
							// 404 (not 403): a host that doesn't exist or belongs to another user is
							// indistinguishable to this caller, so we don't leak its existence.
							throw errors.NOT_FOUND({ data: { message: 'Host not found or not owned by user' } })
						}
					}
					updateFields.host_id = input.hostId ?? ''
				}
				if (changedFields.includes('codingAgent')) {
					updateFields.coding_agent = input.codingAgent
				}
				if (changedFields.includes('provider')) {
					updateFields.provider = input.provider
				}
				if (changedFields.includes('model')) {
					updateFields.model = input.model
				}
				if (changedFields.includes('effort')) {
					updateFields.effort = input.effort
				}
				if (changedFields.includes('fastMode')) {
					updateFields.fast_mode = input.fastMode
				}

				// If archiving an active session, trigger interrupt
				if (
					changedFields.includes('archived') &&
					input.archived === true &&
					ACTIVE_SESSION_STATUSES.includes(session.status)
				) {
					updateFields.status = 'interrupt_requested'
					updateFields.last_activity_at = BigInt(nowMillis)
				}

				// Handle task_id changes with permission check and resource_owner cascade
				// Track cascade data if task changes
				let cascadeData: { taskId: string | null; resourceOwnerUserId: string } | null = null

				// Check if task_id is being explicitly changed (undefined means not changing)
				if (changedFields.includes('taskId')) {
					const targetTaskId = input.taskId ?? null
					let newResourceOwnerUserId = session.resource_owner_user_id

					// If changing to a non-null task, verify write permission on target task
					if (targetTaskId !== null) {
						const targetTaskCheck = await checkTaskWritePermission(
							tx,
							targetTaskId,
							context.auth.userId,
							context.auth.organizationId,
						)
						if (!targetTaskCheck.ok) {
							if (targetTaskCheck.reason === 'not_found') {
								throw errors.NOT_FOUND({ data: { message: 'Target task not found' } })
							}
							throw errors.FORBIDDEN({ data: { message: 'Write permission required on target task' } })
						}
						// Inherit resource_owner from target task
						newResourceOwnerUserId =
							targetTaskCheck.task.resource_owner_user_id ?? session.resource_owner_user_id
					}
					// If changing to null (removing from task), keep current resource_owner

					updateFields.task_id = targetTaskId
					updateFields.resource_owner_user_id = newResourceOwnerUserId
					cascadeData = { taskId: targetTaskId, resourceOwnerUserId: newResourceOwnerUserId }
				}

				// Update session
				const result = await tx
					.update(sessions)
					.set(updateFields)
					.where(eq(sessions.id, input.sessionId))
					.returning({ id: sessions.id })

				if (result.length === 0) {
					throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to update session' } })
				}

				// Cascade task_id AND resource_owner_user_id changes to sub-resources
				if (cascadeData) {
					// Cascade to conversation_events
					await tx
						.update(conversationEvents)
						.set({
							task_id: cascadeData.taskId,
							resource_owner_user_id: cascadeData.resourceOwnerUserId,
						})
						.where(eq(conversationEvents.session_id, input.sessionId))

					// Cascade to approvals
					await tx
						.update(approvals)
						.set({
							task_id: cascadeData.taskId,
							resource_owner_user_id: cascadeData.resourceOwnerUserId,
						})
						.where(eq(approvals.session_id, input.sessionId))

					// The GitHub panel lists a task's branches by these two task_id columns.
					await tx
						.update(sessionRepositories)
						.set({ task_id: cascadeData.taskId })
						.where(eq(sessionRepositories.session_id, input.sessionId))
					await tx
						.update(pullRequests)
						.set({
							task_id: cascadeData.taskId,
							resource_owner_user_id: cascadeData.resourceOwnerUserId,
						})
						.where(eq(pullRequests.session_id, input.sessionId))
					await tx
						.update(pullRequestSessions)
						.set({
							task_id: cascadeData.taskId,
							user_id: cascadeData.resourceOwnerUserId,
						})
						.where(eq(pullRequestSessions.session_id, input.sessionId))
				}

				// If permissions mode changed to bypass, auto-approve ALL pending approvals
				if (changedFields.includes('permissionsMode') && input.permissionsMode === 'bypass') {
					const autoApproved = await tx
						.update(approvals)
						.set({
							status: 'approved',
							comment: 'Auto-approved: permissions mode changed to bypass',
							responded_at: BigInt(nowMillis),
						})
						.where(
							and(
								eq(approvals.session_id, input.sessionId),
								eq(approvals.organization_id, context.auth.organizationId),
								eq(approvals.status, 'pending'),
							),
						)
						.returning({ id: approvals.id })

					// If approvals were resolved, update session status back to running
					if (autoApproved.length > 0) {
						await tx
							.update(sessions)
							.set({
								status: 'running',
								last_activity_at: BigInt(nowMillis),
							})
							.where(eq(sessions.id, input.sessionId))
					}
				}

				// If permissions mode changed to accept_edits, auto-approve only edit-related tools
				if (changedFields.includes('permissionsMode') && input.permissionsMode === 'accept_edits') {
					const autoApproved = await tx
						.update(approvals)
						.set({
							status: 'approved',
							comment: 'Auto-approved: permissions mode changed to accept_edits',
							responded_at: BigInt(nowMillis),
						})
						.where(
							and(
								eq(approvals.session_id, input.sessionId),
								eq(approvals.organization_id, context.auth.organizationId),
								eq(approvals.status, 'pending'),
								inArray(approvals.tool_name, ['Read', 'Edit', 'Write', 'MultiEdit']),
							),
						)
						.returning({ id: approvals.id })

					// If approvals were resolved and no pending approvals remain, update session status
					if (autoApproved.length > 0) {
						const [pendingResult] = await tx
							.select({ count: count() })
							.from(approvals)
							.where(
								and(
									eq(approvals.session_id, input.sessionId),
									eq(approvals.organization_id, context.auth.organizationId),
									eq(approvals.status, 'pending'),
								),
							)

						if (pendingResult && pendingResult.count === 0) {
							await tx
								.update(sessions)
								.set({
									status: 'running',
									last_activity_at: BigInt(nowMillis),
								})
								.where(eq(sessions.id, input.sessionId))
						}
					}
				}

				const txid = await getTxId(tx)
				return { success: true, txid }
			})

			return {
				success: txResult.success,
				transactionId: txResult.txid,
			}
		} catch (error: unknown) {
			if (error instanceof ORPCError) {
				throw error
			}
			logger.error(error, 'Failed to update session')
			throw errors.INTERNAL_SERVER_ERROR()
		}
	})
