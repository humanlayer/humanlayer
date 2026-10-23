import { Effect } from 'effect'

import { advanceRepositorySetupStage } from '../../../effects/project-workspace/repository-progress'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const advanceRepositorySetupStageProcedure = effectOrpcDaemonBase.projectWorkspaces.reportRepositoryResult
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const snapshot = yield* advanceRepositorySetupStage({
			actor: context.auth,
			...input,
		}).pipe(
			Effect.catchTags({
				WorkspaceRepositoryStatusChanged: (error) =>
					Effect.fail(errors.REPOSITORY_STATUS_CHANGED({ data: { snapshot: error.snapshot } })),
				WorkspaceRepositoryProgressInvalid: (error) =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
		return { snapshot }
	})
