import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getGitHubConnectionProcedure = effectOrpcBaseOrganizationRequired.integrations.github.getConnection.effect(
	function* ({ input, context, errors }) {
		const github = yield* GitHubService
		const connection = yield* github
			.getConnection({ organizationId: context.auth.organizationId, connectionId: input.connectionId })
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
					GitHubIntegrationNotConfiguredError: () =>
						Effect.fail(
							errors.BAD_REQUEST({ data: { message: 'GitHub is not set up on this deployment' } }),
						),
				}),
			)
		return { connection }
	},
)
