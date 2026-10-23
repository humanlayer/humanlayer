import { Effect } from 'effect'

import { getProjectRepositorySources } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getProjectV2RepositorySourcesProcedure =
	effectOrpcBaseOrganizationRequired.projects.v2.repositorySources.get.effect(function* ({ input, context, errors }) {
		return yield* getProjectRepositorySources({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			projectId: input.projectId,
			hostId: input.hostId,
		}).pipe(
			Effect.catchTags({
				ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
				ProjectNotFound: (error) =>
					Effect.fail(errors.PROJECT_NOT_FOUND({ data: { projectId: error.projectId } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.HOST_NOT_AUTHORIZED({ data: { message: error.message } })),
				ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
