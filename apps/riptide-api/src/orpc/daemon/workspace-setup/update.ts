import { Effect } from 'effect'

import { WorkspaceSetupService } from '../../../effects/services/workspace-setup/workspace-setup.service'
import type { ApplyDaemonWorkspaceSetupProgressInput } from '../../../effects/services/workspace-setup/workspace-setup.types'
import { effectOrpcDaemonBase } from '../../effect-base'

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

export const updateDaemonWorkspaceSetupProcedure = effectOrpcDaemonBase.workspaceSetup.update.effect(function* ({
	input,
	context,
	errors,
}) {
	const service = yield* WorkspaceSetupService
	const progressUpdate: Mutable<ApplyDaemonWorkspaceSetupProgressInput> = {
		organizationId: context.auth.organizationId,
		authenticatedHostId: context.auth.hostId,
		rowId: input.rowId,
		taskId: input.taskId,
	}
	if (input.repo) progressUpdate.repo = input.repo
	if (input.workspaceState) progressUpdate.workspaceState = input.workspaceState
	if (input.error !== undefined) progressUpdate.error = input.error
	const result = yield* service.applyDaemonProgressUpdate(progressUpdate).pipe(
		Effect.tapError((error) => Effect.logError(error)),
		Effect.catchTags({
			WorkspaceSetupNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
			WorkspaceSetupIntentRejectedError: (error) =>
				Effect.fail(
					errors.BAD_REQUEST({
						data: { message: `Workspace setup update rejected: ${error.reason}` },
					}),
				),
			WorkspaceSetupUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
		}),
	)

	return { transactionId: result.transactionId }
})
