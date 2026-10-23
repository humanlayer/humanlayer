import { Effect } from 'effect'

import { listProjects } from '../../../effects/project-workspace/project-operations'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const listProjectsV2Procedure = effectOrpcBaseOrganizationRequired.projects.v2.list.effect(function* ({
	input,
	context,
	errors,
}) {
	const projects = yield* listProjects({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		archived: input.archived,
	}).pipe(
		Effect.catchTags({
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
	return { projects }
})
