import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const listGitHubConnectionsProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.listConnections.effect(function* ({ context, errors }) {
		const github = yield* GitHubService
		const result = yield* github
			.listConnections({ organizationId: context.auth.organizationId })
			.pipe(Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())))
		return { enabled: result.enabled, connections: [...result.connections] }
	})
