import { Effect } from 'effect'

import { updateProject } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const updateProjectV2Procedure = effectOrpcBaseOrganizationRequired.projects.v2.update.effect(function* ({
	input,
	context,
	errors,
}) {
	const project = yield* updateProject({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		projectId: input.projectId,
		changes: input,
	}).pipe(
		Effect.catchTags({
			ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
			ProjectMutationForbidden: () => Effect.fail(errors.FORBIDDEN()),
			ProjectNotFound: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Project not found' } })),
			ProjectLocationInvalid: (error) => Effect.fail(errors.BAD_REQUEST({ data: { message: error.message } })),
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
	return { project }
})
