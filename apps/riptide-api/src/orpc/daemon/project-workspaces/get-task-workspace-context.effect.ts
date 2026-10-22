import { Effect } from 'effect'

import { readTaskWorkspaceContext } from '../../../effects/project-workspace/task-workspace-context'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const getTaskWorkspaceContextProcedure = effectOrpcDaemonBase.projectWorkspaces.getTaskWorkspaceContext
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		return yield* readTaskWorkspaceContext({ actor: context.auth, taskId: input.taskId }).pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
				ProjectNotFound: () => Effect.fail(errors.NOT_FOUND()),
				WorkspaceRepositoryProgressInvalid: () => Effect.fail(errors.INTERNAL_SERVER_ERROR()),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
