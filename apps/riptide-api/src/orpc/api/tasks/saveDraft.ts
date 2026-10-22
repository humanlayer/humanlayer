import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { getTxId } from '../../../db/get-tx-id'
import { resolveOrgDefaultTaskShareLevel } from '../../../db/organization-settings'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const saveTaskDraftProcedure = effectOrpcBaseOrganizationRequired.tasks.saveDraft.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const { organizationId, userId } = context.auth
	const updatedAt = BigInt(yield* Effect.clockWith((clock) => clock.currentTimeMillis))

	return yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const [task] = yield* tx.query(
					tx.client
						.insert(tasks)
						.values({
							id: input.id,
							name: input.name,
							slug: input.slug,
							default_working_directory: input.defaultWorkingDirectory,
							organization_id: organizationId,
							created_by: userId,
							resource_owner_user_id: userId,
							ticket_id: input.ticketId,
							ticket_description: input.ticketDescription,
							ticket_provider: input.ticketProvider,
							github_connection_id: input.githubConnectionId,
							ticket_repository_id: input.ticketRepositoryId,
							ticket_repository_full_name: input.ticketRepositoryFullName,
							workflow_type: input.workflowType,
							worktree_timing: input.worktreeTiming,
							auto_advance_questions_to_research: input.autoAdvanceQuestionsToResearch,
							auto_advance_research_to_design: input.autoAdvanceResearchToDesign,
							auto_advance_plan_to_worktree: input.autoAdvancePlanToWorktree,
							auto_advance_worktree_to_implementation: input.autoAdvanceWorktreeToImplementation,
							auto_advance_implementation_to_pr: input.autoAdvanceImplementationToPr,
							is_draft: true,
						})
						.onConflictDoUpdate({
							target: tasks.id,
							set: {
								name: input.name,
								slug: input.slug,
								default_working_directory: input.defaultWorkingDirectory,
								ticket_id: input.ticketId,
								ticket_description: input.ticketDescription,
								ticket_provider: input.ticketProvider,
								github_connection_id: input.githubConnectionId,
								ticket_repository_id: input.ticketRepositoryId,
								ticket_repository_full_name: input.ticketRepositoryFullName,
								workflow_type: input.workflowType,
								worktree_timing: input.worktreeTiming,
								auto_advance_questions_to_research: input.autoAdvanceQuestionsToResearch,
								auto_advance_research_to_design: input.autoAdvanceResearchToDesign,
								auto_advance_plan_to_worktree: input.autoAdvancePlanToWorktree,
								auto_advance_worktree_to_implementation: input.autoAdvanceWorktreeToImplementation,
								auto_advance_implementation_to_pr: input.autoAdvanceImplementationToPr,
								updated_at: updatedAt,
							},
							setWhere: and(
								eq(tasks.organization_id, organizationId),
								eq(tasks.resource_owner_user_id, userId),
								eq(tasks.is_draft, true),
								eq(tasks.archived, false),
							),
						})
						.returning(),
				)

				if (!task) return { result: 'draft-id-unavailable' as const }

				const defaultTaskShareLevel = yield* tx.run(() =>
					resolveOrgDefaultTaskShareLevel(tx.client, organizationId),
				)
				yield* tx.query(
					tx.client
						.insert(taskOrganizationAcl)
						.values({
							organization_id: organizationId,
							task_id: task.id,
							resource_owner_user_id: userId,
							permission_level: defaultTaskShareLevel,
							granted_by: userId,
						})
						.onConflictDoNothing({
							target: [taskOrganizationAcl.organization_id, taskOrganizationAcl.task_id],
						}),
				)

				return { result: 'saved' as const, transactionId: yield* tx.run(() => getTxId(tx.client)), task }
			}),
		)
		.pipe(
			Effect.tapError((error) =>
				Effect.logError('Failed to save task draft', error).pipe(
					Effect.annotateLogs({ taskId: input.id, organizationId }),
				),
			),
			Effect.tapError((error) =>
				Effect.sync(() =>
					Sentry.captureException(error, {
						tags: { error_type: 'task_draft_save' },
						extra: { taskId: input.id, organizationId },
					}),
				),
			),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
			Effect.withSpan('tasks.save_draft', { attributes: { task_id: input.id, organization_id: organizationId } }),
		)
})
