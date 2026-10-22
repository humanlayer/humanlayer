import { Effect } from 'effect'

import { skipProjectWorkspaceRepositorySetupStep } from '../../../effects/project-workspace/repository-recovery'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const skipProjectWorkspaceRepositorySetupStepProcedure =
	effectOrpcBaseOrganizationRequired.projectWorkspaces.skipRepositorySetupStep.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* skipProjectWorkspaceRepositorySetupStep({
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
				WorkspaceRepositorySkipNotAllowed: (error) =>
					Effect.fail(errors.SKIP_NOT_ALLOWED({ data: { message: error.message } })),
				WorkspaceRepositoryStatusChanged: (error) =>
					Effect.fail(errors.STATUS_CHANGED({ data: { repository: error.snapshot } })),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
