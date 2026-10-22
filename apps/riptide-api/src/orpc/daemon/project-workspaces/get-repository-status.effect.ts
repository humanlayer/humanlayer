import { Effect } from 'effect'

import { getWorkspaceRepositoryStatusForUserForHost } from '../../../effects/project-workspace/workspace-reads'
import { mapPostgresErrorToResponse } from '../../../effects/services/postgres/error-mapping'
import { effectOrpcDaemonBase, requiresDaemonBillingEffectMiddleware } from '../../effect-base'

export const getWorkspaceRepositoryStatusProcedure = effectOrpcDaemonBase.projectWorkspaces.getRepositoryStatus
	.use(requiresDaemonBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const repositoryStatus = yield* getWorkspaceRepositoryStatusForUserForHost({
			organizationId: context.auth.organizationId,
			projectId: input.projectId,
			workspaceId: input.workspaceId,
			userId: context.auth.userId,
			hostId: context.auth.hostId,
			repositoryIdentity: input.repositoryIdentity,
		}).pipe(
			Effect.catchTags({
				WorkspaceRepositoryProgressInvalid: () => Effect.fail(errors.NOT_FOUND()),
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
		return { repositoryStatus }
	})
