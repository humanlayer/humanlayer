import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const createGitHubInstallUrlProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.github.createInstallUrl.effect(function* ({
		input,
		context,
		errors,
	}) {
		const github = yield* GitHubService
		const installInput: {
			organizationId: string
			requestedByUserId: string
			repairConnectionId?: string
		} = {
			organizationId: context.auth.organizationId,
			requestedByUserId: context.auth.userId,
		}
		if (input?.connectionId) installInput.repairConnectionId = input.connectionId
		return yield* github.createInstallUrl(installInput).pipe(
			Effect.catchTags({
				GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
				GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
