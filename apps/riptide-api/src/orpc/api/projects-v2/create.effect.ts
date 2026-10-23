import { Effect } from 'effect'

import { createProject } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const createProjectV2Procedure = effectOrpcBaseOrganizationRequired.projects.v2.create.effect(function* ({
	input,
	context,
	errors,
}) {
	if ((input.hostId === undefined) !== (input.repositoryPaths === undefined)) {
		return yield* Effect.fail(
			errors.BAD_REQUEST({ data: { message: 'Host and repository paths must be provided together' } }),
		)
	}
	return yield* createProject({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		projectId: input.id,
		initialLocation:
			input.hostId !== undefined && input.repositoryPaths !== undefined
				? { hostId: input.hostId, repositoryPaths: input.repositoryPaths }
				: undefined,
		project: input,
	}).pipe(
		Effect.catchTags({
			ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
			ProjectLocationInvalid: (error) => Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
})
