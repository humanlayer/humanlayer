import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { tasks } from '@humanlayer/db/tables/tasks'
import {
	resolveRepositoryWorkspaceSpec,
	resolveSingleRepositoryWorkspaceSpec,
} from '@humanlayer/db/utils/repository-directory'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { WorkspaceSetupService } from '../../../effects/services/workspace-setup/workspace-setup.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const updateWorkspaceSetupRepositoryDirectoryProcedure =
	effectOrpcBaseOrganizationRequired.workspaceSetup.updateRepositoryDirectory.effect(function* ({
		input,
		context,
		errors,
	}) {
		const postgres = yield* PostgresDb
		const service = yield* WorkspaceSetupService
		const workspaceSpec = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					yield* requireTaskEditPermission(tx, {
						taskId: input.taskId,
						userId: context.auth.userId,
						organizationId: context.auth.organizationId,
					})
					const [ownedHost] = yield* tx.query(
						tx.client
							.select({ hostId: onlineHosts.host_id })
							.from(onlineHosts)
							.where(
								and(
									eq(onlineHosts.host_id, input.hostId),
									eq(onlineHosts.user_id, context.auth.userId),
									eq(onlineHosts.organization_id, context.auth.organizationId),
								),
							)
							.limit(1),
					)
					if (!ownedHost) return yield* Effect.fail(errors.NOT_FOUND())
					const [task] = yield* tx.query(
						tx.client
							.select({ workspaceSpec: tasks.workspace_spec })
							.from(tasks)
							.where(
								and(eq(tasks.id, input.taskId), eq(tasks.organization_id, context.auth.organizationId)),
							)
							.limit(1),
					)
					return task?.workspaceSpec ?? null
				}),
			)
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					TaskPermissionDeniedError: () => Effect.fail(errors.NOT_FOUND()),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		if (!workspaceSpec) {
			return yield* Effect.fail(errors.BAD_REQUEST({ data: { message: 'Task has no workspace specification' } }))
		}
		let resolvedWorkspaceSpec
		try {
			resolvedWorkspaceSpec =
				workspaceSpec.repos.length === 1
					? resolveSingleRepositoryWorkspaceSpec(workspaceSpec, input.repositoryDirectory)
					: resolveRepositoryWorkspaceSpec(workspaceSpec, input.repositoryDirectory)
		} catch (error) {
			return yield* Effect.fail(
				errors.BAD_REQUEST({
					data: { message: error instanceof Error ? error.message : 'Invalid repository directory' },
				}),
			)
		}

		const result = yield* service
			.replaceRepositoryDirectory({
				organizationId: context.auth.organizationId,
				taskId: input.taskId,
				hostId: input.hostId,
				resolvedWorkspaceSpec,
				expectedUpdatedAt: BigInt(input.expectedUpdatedAt),
			})
			.pipe(
				Effect.catchTags({
					WorkspaceSetupNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					WorkspaceSetupIntentRejectedError: (error) =>
						Effect.fail(
							errors.BAD_REQUEST({
								data: { message: `Repository location update rejected: ${error.reason}` },
							}),
						),
					WorkspaceSetupUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)

		return { transactionId: result.transactionId }
	})
