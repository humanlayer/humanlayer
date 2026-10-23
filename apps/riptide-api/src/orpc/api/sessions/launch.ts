import { isEffortSupported, isFastModeSupported } from '@humanlayer/ai/config'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import { ORPCError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'

import { createSessionForLaunch } from '../../../db/create-session-for-launch'
import { getTxId } from '../../../db/get-tx-id'
import { validateHostOwnership } from '../../../db/host-auth'
import { canWriteSession, checkTaskWritePermission } from '../../../db/task-auth'
import { upsertTaskUserSettingsForSession } from '../../../db/upsert-task-user-settings-for-session'
import { upsertWorkspaceSetupRowForTaskSession } from '../../../db/upsert-workspace-setup-row-for-task-session'
import { tryEnsureSessionStreamHydrated } from '../../../effects/services/durable-streams/streams'
import { runSessionTitleGenerationAsync } from '../../../lib/session-title-generation'
import {
	resolveWorkspaceSessionWorkingDirectory,
	resolveWorkspaceSpecForHost,
} from '../../../lib/workspace-setup/resolve-workspace-spec-for-host'
import logger from '../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

/**
 * Launch a new session or launch an existing draft
 *
 * Authorization:
 * - For new sessions: If taskId is provided, user must have write permission on the task
 * - For drafts: User must be session creator AND have edit access (via task ACL or session ownership)
 * - If changing task on draft: User must have write permission on both source and target tasks
 * - Session inherits resource_owner_user_id from task (or creating user if no task/task has no owner)
 */
export const launchSessionProcedure = apiBaseOrgRequired.sessions.launch
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const {
			id,
			eventId,
			draftId,
			taskId,
			title,
			text,
			workingDirectory,
			repositoryDirectory,
			hostId,
			codingAgent,
			provider,
			model,
			effort,
			fastMode,
			permissionsMode,
			updateTaskDefaultWorkingDirectory,
		} = input

		if (!isEffortSupported(codingAgent, provider, model, effort)) {
			throw new ORPCError('BAD_REQUEST', {
				message: `effort=${effort} not supported for ${codingAgent}/${provider}/${model}`,
			})
		}
		if (!isFastModeSupported(codingAgent, provider, model, fastMode)) {
			throw new ORPCError('BAD_REQUEST', {
				message: `fastMode not supported for ${codingAgent}/${provider}/${model}`,
			})
		}
		const organizationId = context.auth.organizationId
		const { services } = context
		const { db } = services

		try {
			const txResult = await db.transaction(async (tx) => {
				let result: typeof sessions.$inferSelect | undefined
				let forceTaskUserWorkingDirectoryUpdate = false

				if (draftId) {
					if (taskId) {
						await tx
							.select({ id: tasks.id })
							.from(tasks)
							.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
							.limit(1)
							.for('no key update')
					}
					// Launching an existing draft - verify it exists and user can write to it
					const [existing] = await tx
						.select()
						.from(sessions)
						.where(and(eq(sessions.id, draftId), eq(sessions.organization_id, organizationId)))
						.for('no key update')

					if (!existing) {
						throw errors.NOT_FOUND({ data: { message: 'Draft session not found' } })
					}

					if (existing.status !== 'draft') {
						throw errors.BAD_REQUEST({ data: { message: 'Session is not a draft' } })
					}

					// Check write permission: user must be session creator AND have task ACL edit (or own standalone session)
					const canWrite = await canWriteSession(tx, existing, context.auth.userId, organizationId)
					if (!canWrite) {
						throw errors.FORBIDDEN({ data: { message: 'Write permission required on session' } })
					}

					// Validate host ownership
					const hostValid = await validateHostOwnership(tx, hostId, context.auth.userId, organizationId)
					if (!hostValid) {
						throw errors.FORBIDDEN({ data: { message: 'Host not found or not owned by user' } })
					}

					// Determine resource_owner_user_id based on task changes
					let resourceOwnerUserId = existing.resource_owner_user_id
					const isTaskChanging = taskId !== undefined && taskId !== existing.task_id

					// If changing to a new task, verify write permission on target task
					if (isTaskChanging && taskId !== null) {
						const targetTaskCheck = await checkTaskWritePermission(
							tx,
							taskId,
							context.auth.userId,
							organizationId,
						)
						if (!targetTaskCheck.ok) {
							if (targetTaskCheck.reason === 'not_found') {
								throw errors.NOT_FOUND({ data: { message: 'Target task not found' } })
							}
							throw errors.FORBIDDEN({ data: { message: 'Write permission required on target task' } })
						}
						// Inherit resource_owner from target task
						resourceOwnerUserId =
							targetTaskCheck.task.resource_owner_user_id ?? existing.resource_owner_user_id
					}

					// Update the draft to launch it
					const [updated] = await tx
						.update(sessions)
						.set({
							task_id: taskId ?? existing.task_id,
							resource_owner_user_id: resourceOwnerUserId,
							status: 'ready_for_launch',
							title,
							prompt: text,
							coding_agent: codingAgent,
							provider,
							model,
							effort: effort ?? null,
							fast_mode: fastMode ?? false,
							working_directory: workingDirectory.trim(),
							host_id: hostId,
							permissions_mode: permissionsMode,
							num_events: 1,
						})
						.where(eq(sessions.id, draftId))
						.returning()

					result = updated

					// Insert initial user message for draft launch
					if (result) {
						const conversationEventValues: typeof conversationEvents.$inferInsert = {
							session_id: result.id,
							organization_id: organizationId,
							resource_owner_user_id: result.resource_owner_user_id,
							task_id: result.task_id,
							event_type: 'message',
							role: 'user',
							content: text,
							user_id: context.auth.userId,
						}
						if (eventId) conversationEventValues.id = eventId
						await tx.insert(conversationEvents).values(conversationEventValues)
					}
				} else {
					// Create new session
					let resourceOwnerUserId = context.auth.userId

					// If taskId is provided, verify write permission and inherit resource_owner
					if (taskId) {
						const taskCheck = await checkTaskWritePermission(
							tx,
							taskId,
							context.auth.userId,
							organizationId,
						)
						if (!taskCheck.ok) {
							if (taskCheck.reason === 'not_found') {
								throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
							}
							throw errors.FORBIDDEN({ data: { message: 'Write permission required on task' } })
						}
						resourceOwnerUserId = taskCheck.task.resource_owner_user_id ?? context.auth.userId
					}

					// Validate host ownership
					const hostValid = await validateHostOwnership(tx, hostId, context.auth.userId, organizationId)
					if (!hostValid) {
						throw errors.FORBIDDEN({ data: { message: 'Host not found or not owned by user' } })
					}

					result = await createSessionForLaunch(tx, {
						id: id ?? undefined,
						eventId: eventId ?? undefined,
						taskId: taskId ?? null,
						organizationId,
						resourceOwnerUserId,
						createdBy: context.auth.userId,
						title,
						prompt: text,
						workingDirectory,
						hostId,
						codingAgent,
						provider,
						model,
						effort: effort ?? undefined,
						fastMode: fastMode ?? undefined,
						permissionsMode,
					})
					// conversation event already inserted by createSessionForLaunch
				}

				if (!result) {
					throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Unable to create/update session' } })
				}

				// Look up ticket_id for AI title generation prefix
				let ticketId: string | null = null
				let taskName: string | null = null
				const effectiveTaskId = result.task_id
				if (effectiveTaskId) {
					const [task] = await tx
						.select({
							ticket_id: tasks.ticket_id,
							name: tasks.name,
							workspace_id: tasks.workspace_id,
							workspace_spec: tasks.workspace_spec,
							worktree_timing: tasks.worktree_timing,
						})
						.from(tasks)
						.where(eq(tasks.id, effectiveTaskId))
						.limit(1)
					ticketId = task?.ticket_id ?? null
					taskName = task?.name ?? null
					if (!task) throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
					if (task.workspace_id !== null) {
						throw errors.BAD_REQUEST({
							data: { message: 'Project-backed tasks require sessions.v2.create' },
						})
					}
					let workspaceSpecForHost = task.workspace_spec
					let hostHasSetupRow = false
					try {
						if (task.worktree_timing === 'now' && task.workspace_spec) {
							const [existingSetup] = await tx
								.select({
									resolvedWorkspaceSpec: taskWorkspaceSetupForHost.resolved_workspace_spec,
								})
								.from(taskWorkspaceSetupForHost)
								.where(
									and(
										eq(taskWorkspaceSetupForHost.organization_id, organizationId),
										eq(taskWorkspaceSetupForHost.task_id, effectiveTaskId),
										eq(taskWorkspaceSetupForHost.host_id, hostId),
									),
								)
								.limit(1)
							hostHasSetupRow = existingSetup !== undefined
							// Rows written before resolved_workspace_spec existed ran setup from
							// the shared task spec, so a host with a row launches with that spec
							// instead of asking for repository locations again.
							workspaceSpecForHost = existingSetup
								? (existingSetup.resolvedWorkspaceSpec ?? task.workspace_spec)
								: resolveWorkspaceSpecForHost({
										workspaceSpec: task.workspace_spec,
										repositoryDirectory,
									})
						}
					} catch (error) {
						throw errors.BAD_REQUEST({
							data: { message: error instanceof Error ? error.message : 'Invalid repository directory' },
						})
					}
					const setupResult = await upsertWorkspaceSetupRowForTaskSession(tx, {
						organizationId,
						taskId: effectiveTaskId,
						hostId,
						workspaceSpec: workspaceSpecForHost,
						// Never rewrite an existing row from a launch: filling a legacy row
						// here would reset its finished setup state and re-run setup.
						initializeMissingMapping: task.worktree_timing === 'now' && !hostHasSetupRow,
					})
					if (workspaceSpecForHost && task.worktree_timing === 'now') {
						forceTaskUserWorkingDirectoryUpdate = setupResult.materialized
						const sessionWorkingDirectory = resolveWorkspaceSessionWorkingDirectory(
							workspaceSpecForHost,
							workingDirectory,
						)
						const [updatedSession] = await tx
							.update(sessions)
							.set({ working_directory: sessionWorkingDirectory })
							.where(eq(sessions.id, result.id))
							.returning()
						if (!updatedSession) {
							throw errors.INTERNAL_SERVER_ERROR({
								data: { message: 'Unable to update session workspace' },
							})
						}
						result = updatedSession
					}
				}

				// Seed per-user settings from the final canonical session directory. Existing
				// preferences change only when requested or when a new host mapping was created.
				if (effectiveTaskId && result.resource_owner_user_id !== context.auth.userId) {
					await upsertTaskUserSettingsForSession(tx, {
						taskId: effectiveTaskId,
						userId: context.auth.userId,
						organizationId,
						workingDirectory: result.working_directory,
						hostId,
						updateExistingDirectory:
							forceTaskUserWorkingDirectoryUpdate || (updateTaskDefaultWorkingDirectory ?? false),
					})
				}

				const txid = await getTxId(tx)

				return {
					session: result,
					txid,
					ticketId,
					taskName,
				}
			})

			// Fire-and-forget AI title generation after transaction commits
			if (!txResult.session.title && text) {
				void runSessionTitleGenerationAsync(db, {
					sessionId: txResult.session.id,
					organizationId,
					userId: txResult.session.created_by,
					prompt: text,
					ticketId: txResult.ticketId,
					taskName: txResult.taskName,
				})
			}

			await tryEnsureSessionStreamHydrated(
				txResult.session.id,
				db,
				{ organizationId, userId: context.auth.userId },
				'launch',
			)

			return {
				transactionId: txResult.txid,
				session: txResult.session,
			}
		} catch (error: unknown) {
			if (error instanceof ORPCError) {
				throw error
			}
			logger.error(error, 'Failed to launch session')
			throw errors.INTERNAL_SERVER_ERROR({})
		}
	})
