import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { Effect } from 'effect'

import { DEFAULT_TASK_SHARE_LEVEL, resolveOrgDefaultTaskShareLevel } from '../../../db/organization-settings'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const createTaskDraftEffectProcedure = effectOrpcBaseOrganizationRequired.tasks.createDraft.effect(function* ({
	input,
	context,
	errors,
}) {
	const postgres = yield* PostgresDb
	const {
		id,
		name,
		slug,
		defaultWorkingDirectory,
		ticketId,
		ticketDescription,
		ticketProvider,
		githubConnectionId,
		ticketRepositoryId,
		ticketRepositoryFullName,
	} = input
	const { userId, organizationId } = context.auth

	const result = yield* postgres
		.transaction((tx) =>
			Effect.gen(function* () {
				const draftValues: typeof tasks.$inferInsert = {
					name: name || 'Untitled Draft',
					slug: slug || null,
					default_working_directory: defaultWorkingDirectory || null,
					organization_id: organizationId,
					created_by: userId,
					resource_owner_user_id: userId,
					ticket_id: ticketId || null,
					ticket_description: ticketDescription || null,
					ticket_provider: ticketProvider || null,
					github_connection_id: githubConnectionId ?? null,
					ticket_repository_id: ticketRepositoryId ?? null,
					ticket_repository_full_name: ticketRepositoryFullName ?? null,
					is_draft: true,
				}
				if (id) draftValues.id = id

				const [insertedTask] = yield* tx.query(tx.client.insert(tasks).values(draftValues).returning())

				if (!insertedTask) {
					return yield* Effect.fail(
						errors.INTERNAL_SERVER_ERROR({ data: { message: 'Unable to insert task draft' } }),
					)
				}

				// Resolve org default task share level
				const defaultTaskShareLevel = yield* tx.run(() =>
					resolveOrgDefaultTaskShareLevel(tx.client, organizationId),
				)

				yield* tx.query(
					tx.client.insert(taskOrganizationAcl).values({
						organization_id: organizationId,
						task_id: insertedTask.id,
						resource_owner_user_id: userId,
						permission_level: defaultTaskShareLevel ?? DEFAULT_TASK_SHARE_LEVEL,
						granted_by: userId,
					}),
				)

				const txid = yield* getTransactionId(tx)

				return { task: insertedTask, txid }
			}),
		)
		.pipe(
			Effect.tap(({ task }) =>
				Effect.logInfo('Task draft created').pipe(
					Effect.annotateLogs({ taskId: task.id, userId, organizationId }),
				),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

	return { transactionId: result.txid, task: result.task }
})
