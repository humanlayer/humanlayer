import { Effect } from 'effect'

import { recoverProjectWorkspaceRepositorySource } from '../../../effects/project-workspace/repository-recovery'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const recoverProjectWorkspaceRepositorySourceProcedure =
	effectOrpcBaseOrganizationRequired.projectWorkspaces.repositorySources.recover.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* recoverProjectWorkspaceRepositorySource({
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
				WorkspaceRepositorySourceRecoveryNotAllowed: (error) =>
					Effect.fail(errors.RECOVERY_NOT_ALLOWED({ data: { message: error.message } })),
				WorkspaceRepositoryStatusChanged: () =>
					Effect.fail(
						errors.STATUS_CHANGED({ data: { message: 'Repository setup changed; reload and try again' } }),
					),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
