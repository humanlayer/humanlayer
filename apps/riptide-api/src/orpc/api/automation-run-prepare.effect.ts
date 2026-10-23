import { isEffortSupported, isFastModeSupported } from '@humanlayer/ai/config'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, or, sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { uuidv7 } from 'uuidv7'

import { createSessionForLaunch } from '../../db/create-session-for-launch'
import { getTaskWithEffectivePermissions } from '../../db/task-auth'
import { lockActiveTaskSlugAllocation } from '../../db/task-slug-allocation'
import {
	buildTaskWorkspaceAndWorkflowValues,
	createTaskWorkspaceAndWorkflowRecords,
} from '../../db/task-workspace-and-workflow'
import { mapPostgresErrorToResponse } from '../../effects/services/postgres/error-mapping'
import type { PostgresDbError } from '../../effects/services/postgres/postgres-db.errors'
import { PostgresDb } from '../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../instrument'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../effect-base'

const AUTOMATION_PREPARATION_LOCK_WAIT_MS = 5_000

export const automationRunPrepareProcedure = effectOrpcBaseOrganizationRequired.automation.run.prepare
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		if (!isEffortSupported(input.codingAgent, input.provider, input.model, input.effort)) {
			return yield* Effect.fail(
				errors.BAD_REQUEST({ data: { message: 'The selected effort is not supported by this model' } }),
			)
		}
		if (!isFastModeSupported(input.codingAgent, input.provider, input.model, input.fastMode)) {
			return yield* Effect.fail(
				errors.BAD_REQUEST({ data: { message: 'Fast mode is not supported by this model' } }),
			)
		}

		const postgres = yield* PostgresDb
		const { organizationId, userId } = context.auth
		const now = BigInt(yield* Effect.clockWith((clock) => clock.currentTimeMillis))
		const mapPreparationError = (error: PostgresDbError) => {
			if (error.kind === 'timeout') {
				return Effect.fail(errors.AUTOMATION_PREPARATION_BUSY({ data: { retryAfterSeconds: 1 } }))
			}
			return mapPostgresErrorToResponse(error, errors)
		}

		const prepared = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					let task: typeof tasks.$inferSelect

					if (input.taskMode === 'ensure') {
						yield* tx.query(
							tx.client.execute(
								sql`SELECT set_config('lock_timeout', ${`${AUTOMATION_PREPARATION_LOCK_WAIT_MS}ms`}, true)`,
							),
						)
						yield* tx.run(() =>
							lockActiveTaskSlugAllocation(tx.client, { organizationId, slug: input.slug }),
						)

						const [existing] = yield* tx.query(
							tx.client
								.select()
								.from(tasks)
								.where(
									and(
										eq(tasks.organization_id, organizationId),
										eq(tasks.slug, input.slug),
										eq(tasks.is_draft, false),
									),
								)
								.limit(1),
						)

						if (existing) {
							const authorized = yield* tx.run(() =>
								getTaskWithEffectivePermissions(tx.client, existing.id, userId, organizationId),
							)
							if (!authorized) {
								return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } }))
							}
							if (authorized.effectivePermission !== 'edit') {
								return yield* Effect.fail(
									errors.FORBIDDEN({ data: { message: 'Write permission required on task' } }),
								)
							}
							task = existing
						} else {
							const resolved = buildTaskWorkspaceAndWorkflowValues(input.task)
							const [created] = yield* tx.query(
								tx.client
									.insert(tasks)
									.values({
										id: uuidv7(),
										...resolved.taskValues,
										slug: input.slug,
										organization_id: organizationId,
										created_by: userId,
										resource_owner_user_id: userId,
										created_at: now,
										updated_at: now,
										archived: false,
										is_draft: false,
										slack_notifications_muted: false,
									})
									.returning(),
							)
							if (!created) return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())

							yield* tx.run(() =>
								createTaskWorkspaceAndWorkflowRecords(tx.client, {
									taskId: created.id,
									organizationId,
									userId,
									configuration: input.task,
									workspaceSpec: resolved.workspaceSpec,
									setupHostId: input.task.hostId,
								}),
							)
							task = created
						}
					} else {
						const [selected] = yield* tx.query(
							tx.client
								.select()
								.from(tasks)
								.where(
									and(
										eq(tasks.organization_id, organizationId),
										eq(tasks.is_draft, false),
										or(
											sql`${tasks.id}::text = ${input.taskIdOrSlug}`,
											eq(tasks.slug, input.taskIdOrSlug),
										),
									),
								)
								.limit(1),
						)
						if (!selected) {
							return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } }))
						}

						const authorized = yield* tx.run(() =>
							getTaskWithEffectivePermissions(tx.client, selected.id, userId, organizationId),
						)
						if (!authorized) {
							return yield* Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } }))
						}
						if (authorized.effectivePermission !== 'edit') {
							return yield* Effect.fail(
								errors.FORBIDDEN({ data: { message: 'Write permission required on task' } }),
							)
						}
						task = selected
					}

					const session = yield* tx.run(() =>
						createSessionForLaunch(tx.client, {
							taskId: task.id,
							organizationId,
							resourceOwnerUserId: task.resource_owner_user_id,
							createdBy: userId,
							title: input.sessionName,
							prompt: input.prompt,
							workingDirectory: input.workingDirectory,
							hostId: input.hostId,
							codingAgent: input.codingAgent,
							provider: input.provider,
							model: input.model,
							effort: input.effort ?? undefined,
							fastMode: input.fastMode ?? undefined,
							permissionsMode: input.permissionsMode,
						}),
					)
					return { taskId: task.id, sessionId: session.id }
				}),
			)
			.pipe(
				Effect.tapError((error) =>
					Effect.logError('Failed to prepare automation run', error).pipe(
						Effect.annotateLogs({ organizationId, userId, hostId: input.hostId }),
					),
				),
				Effect.tapError((error) =>
					Effect.sync(() =>
						Sentry.captureException(error, {
							tags: { error_type: 'automation_run_preparation' },
							extra: { organizationId, userId, hostId: input.hostId },
						}),
					),
				),
				Effect.catchTags({
					PostgresDbQueryError: mapPreparationError,
					PostgresDbTransactionError: mapPreparationError,
				}),
			)

		return {
			taskId: prepared.taskId,
			userId,
			hostId: input.hostId,
			sessionId: prepared.sessionId,
		}
	})
