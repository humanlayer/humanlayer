import { Effect } from 'effect'

import { upsertProjectRepositorySources } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const upsertProjectV2RepositorySourcesProcedure =
	effectOrpcBaseOrganizationRequired.projects.v2.repositorySources.upsert.effect(function* ({
		input,
		context,
		errors,
	}) {
		return yield* upsertProjectRepositorySources({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			...input,
		}).pipe(
			Effect.catchTags({
				ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
				ProjectNotFound: (error) =>
					Effect.fail(errors.PROJECT_NOT_FOUND({ data: { projectId: error.projectId } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.HOST_NOT_AUTHORIZED({ data: { message: error.message } })),
				RepositorySourcesInvalid: (error) =>
					Effect.fail(errors.REPOSITORY_SOURCES_INVALID({ data: { message: error.message } })),
				ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
