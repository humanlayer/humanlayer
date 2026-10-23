import { Effect } from 'effect'

import { upsertProjectLocation } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const upsertProjectV2LocationProcedure = effectOrpcBaseOrganizationRequired.projects.v2.locations.upsert.effect(
	function* ({ input, context, errors }) {
		const location = yield* upsertProjectLocation({
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			projectId: input.projectId,
			hostId: input.hostId,
			repositoryPaths: input.repositoryPaths,
		}).pipe(
			Effect.catchTags({
				ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
				ProjectNotFound: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Project not found' } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
				ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
		return { location }
	},
)
