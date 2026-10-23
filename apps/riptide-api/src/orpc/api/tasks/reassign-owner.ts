import { Effect } from 'effect'

import { reassignTaskOwner } from '../../../effects/task-owner-reassignment/reassign-task-owner'
import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

export const reassignTaskOwnerProcedure = effectOrpcBaseOrganizationRequired.tasks.reassignOwner.effect(function* ({
	input,
	context,
	errors,
}) {
	const { userId, organizationId, workosOrganizationId } = context.auth
	const actingUserIsOrganizationAdmin =
		context.auth.role === 'admin' || context.auth.roles?.includes('admin') === true

	return yield* reassignTaskOwner({
		taskId: input.taskId,
		newOwnerUserId: input.newOwnerUserId,
		actingUserId: userId,
		organizationId,
		workosOrganizationId,
		actingUserIsOrganizationAdmin,
	}).pipe(
		Effect.catchTags({
			TaskOwnerTaskNotFoundError: () => Effect.fail(errors.NOT_FOUND({ data: { message: 'Task not found' } })),
			TaskOwnerReassignmentForbiddenError: () =>
				Effect.fail(errors.FORBIDDEN({ data: { message: 'Only the task owner or an admin can reassign it' } })),
			TaskOwnerRecipientIneligibleError: () =>
				Effect.fail(
					errors.TASK_OWNER_RECIPIENT_INELIGIBLE({
						data: { message: 'The selected user is not an active member of this organization' },
					}),
				),
			TaskOwnerRecipientUnchangedError: () =>
				Effect.fail(
					errors.TASK_OWNER_UNCHANGED({ data: { message: 'The selected user already owns this task' } }),
				),
			TaskOwnerWorkosFailureError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			TaskOwnerDatabaseFailureError: (error) =>
				Effect.fail(error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR()),
		}),
	)
})
