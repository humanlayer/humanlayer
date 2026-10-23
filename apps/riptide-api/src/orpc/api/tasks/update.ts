import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifactVersions } from '@humanlayer/db/tables/artifact-versions'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { ORPCError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'

import { getTxId } from '../../../db/get-tx-id'
import { checkTaskWritePermission, type TaskWithAuth } from '../../../db/task-auth'
import logger from '../../../logger'
import { apiBaseOrgRequired, requiresBillingMiddleware } from '../../base'

/**
 * Update a task
 *
 * Authorization: User must have write permission on task (via ownership or ACL)
 */
export const updateTaskProcedure = apiBaseOrgRequired.tasks.update
	.use(requiresBillingMiddleware)
	.handler(async ({ input, context, errors }) => {
		const {
			taskId,
			name,
			defaultWorkingDirectory,
			setupStatus,
			setupDetails,
			slug,
			ticketId,
			ticketDescription,
			ticketProvider,
			githubConnectionId,
			ticketRepositoryId,
			ticketRepositoryFullName,
			workflowType,
			autoAdvanceQuestionsToResearch,
			autoAdvanceResearchToDesign,
			autoAdvancePlanToWorktree,
			autoAdvanceWorktreeToImplementation,
			autoAdvanceImplementationToPr,
			slackNotificationsMuted,
		} = input
		const organizationId = context.auth.organizationId
		const { services } = context
		const { db } = services

		// Same-org admins may force-rename tasks they neither own nor hold an ACL on.
		// The bypass is deliberately narrow: it only applies when `name` is the sole
		// field being changed — any other (owner-only or user-settings) field present
		// disqualifies it. Reuses the JWT claim `requireAdmin` reads.
		const isAdmin = context.auth.role === 'admin' || context.auth.roles?.includes('admin')
		const onlyNameChanged =
			name !== undefined &&
			defaultWorkingDirectory === undefined &&
			setupStatus === undefined &&
			setupDetails === undefined &&
			slug === undefined &&
			ticketId === undefined &&
			ticketDescription === undefined &&
			ticketProvider === undefined &&
			githubConnectionId === undefined &&
			ticketRepositoryId === undefined &&
			ticketRepositoryFullName === undefined &&
			workflowType === undefined &&
			autoAdvanceQuestionsToResearch === undefined &&
			autoAdvanceResearchToDesign === undefined &&
			autoAdvancePlanToWorktree === undefined &&
			autoAdvanceWorktreeToImplementation === undefined &&
			autoAdvanceImplementationToPr === undefined &&
			slackNotificationsMuted === undefined

		try {
			const txResult = await db.transaction(async (tx) => {
				// 1. Verify write permission on task (via ownership or ACL)
				const taskCheck = await checkTaskWritePermission(tx, taskId, context.auth.userId, organizationId)

				// The authorized task to operate on. For the admin name-override path we
				// re-load the task independently (checkTaskWritePermission returns
				// `not_found` for a same-org task the caller can't access).
				let effectiveTask: TaskWithAuth
				let adminNameOverride = false
				if (!taskCheck.ok) {
					if (isAdmin && onlyNameChanged) {
						const [adminTask] = await tx
							.select({
								id: tasks.id,
								slug: tasks.slug,
								resource_owner_user_id: tasks.resource_owner_user_id,
								organization_id: tasks.organization_id,
								default_working_directory: tasks.default_working_directory,
								auto_advance_questions_to_research: tasks.auto_advance_questions_to_research,
								auto_advance_research_to_design: tasks.auto_advance_research_to_design,
								auto_advance_plan_to_worktree: tasks.auto_advance_plan_to_worktree,
								auto_advance_worktree_to_implementation: tasks.auto_advance_worktree_to_implementation,
								auto_advance_implementation_to_pr: tasks.auto_advance_implementation_to_pr,
								ticket_provider: tasks.ticket_provider,
								github_connection_id: tasks.github_connection_id,
								ticket_repository_id: tasks.ticket_repository_id,
							})
							.from(tasks)
							.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
							.limit(1)
						if (!adminTask) {
							throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
						}
						effectiveTask = adminTask
						adminNameOverride = true
					} else if (taskCheck.reason === 'not_found') {
						throw errors.NOT_FOUND({ data: { message: 'Task not found' } })
					} else {
						throw errors.FORBIDDEN({ data: { message: 'Write permission required on task' } })
					}
				} else {
					effectiveTask = taskCheck.task
				}

				// IMMUTABILITY: Once slug is non-null, it cannot be changed
				if (effectiveTask.slug && slug !== undefined && slug !== effectiveTask.slug) {
					throw errors.BAD_REQUEST({
						data: { message: 'Task slug cannot be changed once set (required for permalinks)' },
					})
				}

				// Determine ownership for routing updates
				const isOwner = effectiveTask.resource_owner_user_id === context.auth.userId

				// For non-owners, validate they're only updating user-settings-compatible fields
				// and route those fields to task_user_settings instead of the task table
				let userSettingsHandledSeparately = false
				const hasUserSettingsFields =
					defaultWorkingDirectory !== undefined ||
					autoAdvanceQuestionsToResearch !== undefined ||
					autoAdvanceResearchToDesign !== undefined ||
					autoAdvancePlanToWorktree !== undefined ||
					autoAdvanceWorktreeToImplementation !== undefined ||
					autoAdvanceImplementationToPr !== undefined

				const hasTaskOnlyFields =
					name !== undefined ||
					slug !== undefined ||
					setupStatus !== undefined ||
					setupDetails !== undefined ||
					ticketId !== undefined ||
					ticketDescription !== undefined ||
					ticketProvider !== undefined ||
					githubConnectionId !== undefined ||
					ticketRepositoryId !== undefined ||
					ticketRepositoryFullName !== undefined ||
					workflowType !== undefined ||
					// Slack mute is a task-level, owner-only field (it gates owner-filtered automations for the task).
					slackNotificationsMuted !== undefined

				if (!isOwner) {
					// Non-owners cannot update task-only fields — except a same-org admin
					// force-renaming (name-only), validated above.
					if (hasTaskOnlyFields && !adminNameOverride) {
						throw errors.FORBIDDEN({
							data: { message: 'Only task owners can update name, slug, setupStatus, or setupDetails' },
						})
					}

					// Route user-settings-compatible fields to task_user_settings
					if (hasUserSettingsFields) {
						userSettingsHandledSeparately = true

						// Build values for the upsert:
						// On INSERT (new row): copy current task values, then override with provided fields
						// On UPDATE (existing row): only update the fields being changed
						// null means "no per-user preference"; readers fall through to settingsStore.defaultDirectory
						const insertWorkingDirectory = defaultWorkingDirectory ?? null
						const insertQuestionsToResearch =
							autoAdvanceQuestionsToResearch ?? effectiveTask.auto_advance_questions_to_research
						const insertResearchToDesign =
							autoAdvanceResearchToDesign ?? effectiveTask.auto_advance_research_to_design
						const insertPlanToWorktree =
							autoAdvancePlanToWorktree ?? effectiveTask.auto_advance_plan_to_worktree
						const insertWorktreeToImplementation =
							autoAdvanceWorktreeToImplementation ?? effectiveTask.auto_advance_worktree_to_implementation
						const insertImplementationToPr =
							autoAdvanceImplementationToPr ?? effectiveTask.auto_advance_implementation_to_pr
						const userSettingsUpdates: Partial<typeof taskUserSettings.$inferInsert> = {}
						if (defaultWorkingDirectory !== undefined)
							userSettingsUpdates.working_directory = defaultWorkingDirectory
						if (autoAdvanceQuestionsToResearch !== undefined)
							userSettingsUpdates.auto_advance_questions_to_research = autoAdvanceQuestionsToResearch
						if (autoAdvanceResearchToDesign !== undefined)
							userSettingsUpdates.auto_advance_research_to_design = autoAdvanceResearchToDesign
						if (autoAdvancePlanToWorktree !== undefined)
							userSettingsUpdates.auto_advance_plan_to_worktree = autoAdvancePlanToWorktree
						if (autoAdvanceWorktreeToImplementation !== undefined)
							userSettingsUpdates.auto_advance_worktree_to_implementation =
								autoAdvanceWorktreeToImplementation
						if (autoAdvanceImplementationToPr !== undefined)
							userSettingsUpdates.auto_advance_implementation_to_pr = autoAdvanceImplementationToPr

						await tx
							.insert(taskUserSettings)
							.values({
								task_id: taskId,
								user_id: context.auth.userId,
								organization_id: organizationId,
								working_directory: insertWorkingDirectory,
								auto_advance_questions_to_research: insertQuestionsToResearch,
								auto_advance_research_to_design: insertResearchToDesign,
								auto_advance_plan_to_worktree: insertPlanToWorktree,
								auto_advance_worktree_to_implementation: insertWorktreeToImplementation,
								auto_advance_implementation_to_pr: insertImplementationToPr,
							})
							.onConflictDoUpdate({
								target: [
									taskUserSettings.organization_id,
									taskUserSettings.user_id,
									taskUserSettings.task_id,
								],
								set: userSettingsUpdates,
							})
					}
				}

				const mergedTicketProvider =
					ticketProvider === undefined ? effectiveTask.ticket_provider : ticketProvider
				const mergedGitHubConnectionId =
					githubConnectionId === undefined ? effectiveTask.github_connection_id : githubConnectionId
				const mergedTicketRepositoryId =
					ticketRepositoryId === undefined ? effectiveTask.ticket_repository_id : ticketRepositoryId
				const hasGitHubConnection = mergedGitHubConnectionId !== null
				const hasGitHubRepository = mergedTicketRepositoryId !== null
				if (
					hasGitHubConnection !== hasGitHubRepository ||
					(mergedTicketProvider === 'github' && !hasGitHubConnection) ||
					(mergedTicketProvider !== 'github' && hasGitHubConnection)
				) {
					throw errors.BAD_REQUEST({ data: { message: 'GitHub ticket identity is incomplete or stale' } })
				}

				// Build update object with only provided fields
				// For non-owners, user-settings fields were already handled above
				const updates: Partial<typeof tasks.$inferInsert> = {}
				if (name !== undefined) updates.name = name
				if (setupStatus !== undefined) updates.setup_status = setupStatus
				if (setupDetails !== undefined) updates.setup_details = setupDetails
				if (slug !== undefined) updates.slug = slug
				if (ticketId !== undefined) updates.ticket_id = ticketId
				if (ticketDescription !== undefined) updates.ticket_description = ticketDescription
				if (ticketProvider !== undefined) updates.ticket_provider = ticketProvider
				if (githubConnectionId !== undefined) updates.github_connection_id = githubConnectionId
				if (ticketRepositoryId !== undefined) updates.ticket_repository_id = ticketRepositoryId
				if (ticketRepositoryFullName !== undefined)
					updates.ticket_repository_full_name = ticketRepositoryFullName
				// Owner-only task-level fields; non-owners were already rejected above via hasTaskOnlyFields.
				if (workflowType !== undefined) updates.workflow_type = workflowType
				if (slackNotificationsMuted !== undefined) updates.slack_notifications_muted = slackNotificationsMuted
				if (!userSettingsHandledSeparately) {
					// Only owners reach here with these fields
					if (defaultWorkingDirectory !== undefined)
						updates.default_working_directory = defaultWorkingDirectory
					if (autoAdvanceQuestionsToResearch !== undefined)
						updates.auto_advance_questions_to_research = autoAdvanceQuestionsToResearch
					if (autoAdvanceResearchToDesign !== undefined)
						updates.auto_advance_research_to_design = autoAdvanceResearchToDesign
					if (autoAdvancePlanToWorktree !== undefined)
						updates.auto_advance_plan_to_worktree = autoAdvancePlanToWorktree
					if (autoAdvanceWorktreeToImplementation !== undefined)
						updates.auto_advance_worktree_to_implementation = autoAdvanceWorktreeToImplementation
					if (autoAdvanceImplementationToPr !== undefined)
						updates.auto_advance_implementation_to_pr = autoAdvanceImplementationToPr
				}

				if (Object.keys(updates).length === 0) {
					// No task-table fields to update — if we handled user settings separately, still return success
					if (userSettingsHandledSeparately) {
						return { txid: await getTxId(tx) }
					}
					throw errors.BAD_REQUEST({ data: { message: 'No fields to update' } })
				}

				const [result] = await tx.update(tasks).set(updates).where(eq(tasks.id, taskId)).returning()

				if (!result) {
					throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to update task' } })
				}

				// Cascade slug to artifacts if newly set
				if (slug && !effectiveTask.slug) {
					await tx.update(artifacts).set({ task_slug: slug }).where(eq(artifacts.task_id, taskId))

					await tx
						.update(artifactVersions)
						.set({ task_slug: slug })
						.where(eq(artifactVersions.task_id, taskId))

					await tx
						.update(artifactOperationsLog)
						.set({ task_slug: slug })
						.where(eq(artifactOperationsLog.task_id, taskId))
				}

				return { txid: await getTxId(tx) }
			})
			return {
				transactionId: txResult.txid,
				success: true,
			}
		} catch (error: unknown) {
			// Re-throw oRPC errors as-is
			if (error instanceof ORPCError) {
				throw error
			}
			// Wrap unknown errors in INTERNAL_SERVER_ERROR
			logger.error('Failed to update task')
			logger.error(error)
			throw errors.INTERNAL_SERVER_ERROR()
		}
	})
