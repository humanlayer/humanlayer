import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const refreshGitHubConnectionProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.github.refreshConnection.effect(function* ({
		input,
		context,
		errors,
	}) {
		const github = yield* GitHubService
		const connection = yield* github
			.refreshConnection({ organizationId: context.auth.organizationId, connectionId: input.connectionId })
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubInstallationSuspendedError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'installation_suspended' } })),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		return { connection }
	})
