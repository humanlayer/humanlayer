import { Effect } from 'effect'

import { createSessionV2 } from '../../../../effects/project-workspace/create-session-v2'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const createSessionV2Procedure = effectOrpcBaseOrganizationRequired.sessions.v2.create.effect(function* ({
	input,
	context,
	errors,
}) {
	return yield* createSessionV2({
		actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
		sessionId: input.sessionId,
		draftId: input.draftId,
		eventId: input.eventId,
		taskId: input.taskId,
		workspaceId: input.workspaceId,
		title: input.title,
		text: input.text,
		hostId: input.hostId,
		codingAgent: input.codingAgent,
		provider: input.provider,
		model: input.model,
		effort: input.effort,
		fastMode: input.fastMode,
		permissionsMode: input.permissionsMode,
		defaultRepositoryIdentity: input.defaultRepositoryIdentity,
	}).pipe(
		Effect.catchTags({
			ProjectsV2Disabled: () =>
				Effect.fail(errors.FORBIDDEN({ message: 'Projects V2 is not enabled for this user.' })),
			ProjectMutationForbidden: () =>
				Effect.fail(errors.FORBIDDEN({ message: 'You do not have permission to launch this session.' })),
			ProjectNotFound: (error) => Effect.fail(errors.TASK_NOT_FOUND({ data: { taskId: error.projectId } })),
			ProjectLocationInvalid: (error) =>
				Effect.fail(errors.HOST_NOT_AUTHORIZED({ message: error.message, data: { message: error.message } })),
			ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			RepositorySourcesRequired: (error) =>
				Effect.fail(
					errors.REPOSITORY_SOURCES_REQUIRED({
						data: {
							projectId: error.projectId,
							workspaceId: error.workspaceId,
							hostId: error.hostId,
							missingRepositoryIdentities: [...error.missingRepositoryIdentities],
						},
					}),
				),
			PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)
})
