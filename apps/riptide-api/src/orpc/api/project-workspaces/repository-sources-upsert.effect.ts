import { Effect } from 'effect'

import { upsertProjectWorkspaceRepositorySources } from '../../../effects/project-workspace/workspace-repository-sources'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const upsertProjectWorkspaceRepositorySourcesProcedure =
	effectOrpcBaseOrganizationRequired.projectWorkspaces.repositorySources.upsert.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* upsertProjectWorkspaceRepositorySources({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			...input,
		}).pipe(
			Effect.catchTags({
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				TaskPermissionDeniedError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
				WorkspaceRepositoryProgressInvalid: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.HOST_NOT_AUTHORIZED({ data: { message: error.message } })),
				RepositorySourcesInvalid: (error) =>
					Effect.fail(errors.REPOSITORY_SOURCES_INVALID({ data: { message: error.message } })),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
