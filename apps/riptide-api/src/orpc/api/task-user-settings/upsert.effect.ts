import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId, requireTaskReadPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'

/**
 * Upsert per-user task settings.
 *
 * Authorization: User must have read permission on task (via ownership or ACL).
 */
export const upsertTaskUserSettingsProcedure = effectOrpcBaseOrganizationRequired.taskUserSettings.upsert
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth
		const {
			taskId,
			workingDirectory,
			hostId,
			autoAdvanceQuestionsToResearch,
			autoAdvanceResearchToDesign,
			autoAdvancePlanToWorktree,
			autoAdvanceWorktreeToImplementation,
			autoAdvanceImplementationToPr,
		} = input
		const conflictUpdates: Partial<typeof taskUserSettings.$inferInsert> = {
			// Always touch updated_at so the set clause is never empty and
			// we have an accurate "last seen" timestamp even when no other
			// fields change.
			updated_at: BigInt(Date.now()),
		}
		if (workingDirectory !== undefined) conflictUpdates.working_directory = workingDirectory ?? null
		if (hostId !== undefined) conflictUpdates.host_id = hostId ?? null
		if (autoAdvanceQuestionsToResearch !== undefined)
			conflictUpdates.auto_advance_questions_to_research = autoAdvanceQuestionsToResearch ?? false
		if (autoAdvanceResearchToDesign !== undefined)
			conflictUpdates.auto_advance_research_to_design = autoAdvanceResearchToDesign ?? false
		if (autoAdvancePlanToWorktree !== undefined)
			conflictUpdates.auto_advance_plan_to_worktree = autoAdvancePlanToWorktree ?? false
		if (autoAdvanceWorktreeToImplementation !== undefined)
			conflictUpdates.auto_advance_worktree_to_implementation = autoAdvanceWorktreeToImplementation ?? false
		if (autoAdvanceImplementationToPr !== undefined)
			conflictUpdates.auto_advance_implementation_to_pr = autoAdvanceImplementationToPr ?? false

		const result = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					yield* requireTaskReadPermission(tx, { taskId, userId, organizationId })

					const [settings] = yield* tx.query(
						tx.client
							.insert(taskUserSettings)
							.values({
								task_id: taskId,
								user_id: userId,
								organization_id: organizationId,
								working_directory: workingDirectory ?? null, // null means "no per-user preference"; readers fall through to settingsStore.defaultDirectory
								host_id: hostId ?? null,
								auto_advance_questions_to_research: autoAdvanceQuestionsToResearch ?? false,
								auto_advance_research_to_design: autoAdvanceResearchToDesign ?? false,
								auto_advance_plan_to_worktree: autoAdvancePlanToWorktree ?? false,
								auto_advance_worktree_to_implementation: autoAdvanceWorktreeToImplementation ?? false,
								auto_advance_implementation_to_pr: autoAdvanceImplementationToPr ?? false,
							})
							.onConflictDoUpdate({
								target: [
									taskUserSettings.organization_id,
									taskUserSettings.user_id,
									taskUserSettings.task_id,
								],
								set: conflictUpdates,
							})
							.returning(),
					)

					if (!settings) throw new Error('upsert returned no row')

					const transactionId = yield* getTransactionId(tx)

					return { transactionId, settings }
				}),
			)
			.pipe(
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		yield* Effect.logInfo('Task user settings upserted').pipe(Effect.annotateLogs({ taskId, userId }))

		return result
	})
