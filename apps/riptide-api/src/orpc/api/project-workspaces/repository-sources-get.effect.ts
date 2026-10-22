import { Effect } from 'effect'

import { getProjectWorkspaceRepositorySources } from '../../../effects/project-workspace/workspace-repository-sources'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getProjectWorkspaceRepositorySourcesProcedure =
	effectOrpcBaseOrganizationRequired.projectWorkspaces.repositorySources.get.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* getProjectWorkspaceRepositorySources({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			...input,
		}).pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				WorkspaceRepositoryProgressInvalid: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.HOST_NOT_AUTHORIZED({ data: { message: error.message } })),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
