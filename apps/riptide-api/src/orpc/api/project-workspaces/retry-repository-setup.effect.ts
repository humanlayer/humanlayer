import { Effect } from 'effect'

import { retryProjectWorkspaceRepositorySetup } from '../../../effects/project-workspace/repository-recovery'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const retryProjectWorkspaceRepositorySetupProcedure =
	effectOrpcBaseOrganizationRequired.projectWorkspaces.retryRepositorySetup.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* retryProjectWorkspaceRepositorySetup({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			...input,
		}).pipe(
			Effect.map((repository) => ({ repository })),
			Effect.catchTags({
				ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
				TaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Repository not found' } })),
				TaskPermissionDeniedError: () =>
					Effect.fail(errors.NOT_FOUND({ data: { message: 'Repository not found' } })),
				WorkspaceRepositoryProgressInvalid: (error) =>
					Effect.fail(errors.NOT_FOUND({ data: { message: error.message } })),
				WorkspaceRepositoryNothingToRetry: (error) =>
					Effect.fail(errors.NOTHING_TO_RETRY({ data: { repository: error.snapshot } })),
				WorkspaceRepositoryStatusChanged: (error) =>
					Effect.fail(errors.STATUS_CHANGED({ data: { repository: error.snapshot } })),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
