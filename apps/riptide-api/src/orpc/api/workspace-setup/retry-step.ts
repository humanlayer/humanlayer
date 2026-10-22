import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { requireTaskEditPermission } from '../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../effects/services/postgres/postgres-db.service'
import { WorkspaceSetupService } from '../../../effects/services/workspace-setup/workspace-setup.service'
import { Sentry } from '../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const retryWorkspaceSetupStepProcedure = effectOrpcBaseOrganizationRequired.workspaceSetup.retryStep.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const service = yield* WorkspaceSetupService
		yield* postgres
			.transaction((tx) =>
				requireTaskEditPermission(tx, {
					taskId: input.taskId,
					userId: context.auth.userId,
					organizationId: context.auth.organizationId,
				}),
			)
			.pipe(
				Effect.asVoid,
				Effect.tapError((error) => Effect.logError(error)),
				Effect.tapError((error) => Effect.sync(() => Sentry.captureException(error))),
				Effect.catchTags({
					TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					TaskPermissionDeniedError: () => Effect.fail(errors.NOT_FOUND()),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		const result = yield* service
			.applyRetryIntent({
				organizationId: context.auth.organizationId,
				taskId: input.taskId,
				hostId: input.hostId,
				localPath: input.localPath,
				stage: input.stage,
			})
			.pipe(
				Effect.tapError((error) => Effect.logError(error)),
				Effect.catchTags({
					WorkspaceSetupNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					WorkspaceSetupIntentRejectedError: (error) =>
						Effect.fail(
							errors.BAD_REQUEST({
								data: { message: `Setup retry rejected: ${error.reason}` },
							}),
						),
					WorkspaceSetupUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)

		return { transactionId: result.transactionId }
	},
)
