import { Effect } from 'effect'

import { getProject } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const getProjectV2Procedure = effectOrpcBaseOrganizationRequired.projects.v2.get.effect(function* ({
	input,
	context,
	errors,
}) {
	return yield* getProject({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		projectId: input.projectId,
		hostId: input.hostId,
	}).pipe(
		Effect.catchTags({
			ProjectNotFound: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Project not found' } })),
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
})
