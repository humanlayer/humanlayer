import { Effect } from 'effect'

import { archiveProject } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const archiveProjectV2Procedure = effectOrpcBaseOrganizationRequired.projects.v2.archive.effect(function* ({
	input,
	context,
	errors,
}) {
	const project = yield* archiveProject({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		projectId: input.projectId,
		archived: input.archived,
	}).pipe(
		Effect.catchTags({
			ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
			ProjectMutationForbidden: () => Effect.fail(errors.FORBIDDEN()),
			ProjectNotFound: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Project not found' } })),
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
	return { project }
})
