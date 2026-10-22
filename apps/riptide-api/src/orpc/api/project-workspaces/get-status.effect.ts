import { Effect } from 'effect'

import { getProjectWorkspaceStatus } from '../../../effects/project-workspace/workspace-status'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getProjectWorkspaceStatusProcedure = effectOrpcBaseOrganizationRequired.projectWorkspaces.getStatus.effect(
	function* ({ input, context, errors }) {
		return yield* getProjectWorkspaceStatus({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			...input,
		}).pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				WorkspaceRepositoryProgressInvalid: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	},
)
