import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const disconnectGitHubProcedure = effectOrpcBaseForOrganizationAdmin.integrations.github.disconnect.effect(
	function* ({ input, context, errors }) {
		const github = yield* GitHubService
		const result = yield* github
			.disconnect({ organizationId: context.auth.organizationId, connectionId: input.connectionId })
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					// Local rows are preserved on a GitHub failure; the UI surfaces a retry.
					GitHubDisconnectFailedError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		return { success: result.success }
	},
)
