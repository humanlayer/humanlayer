import { Effect } from 'effect'

import { readGitHubStatusInput } from '../../../../effects/services/github/github.persistence'
import { deriveGitHubStatus } from '../../../../effects/services/github/github.status'
import { isOrganizationAdmin } from '../../../base'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getGitHubStatusProcedure = effectOrpcBaseOrganizationRequired.integrations.github.getStatus.effect(
	function* ({ context, errors }) {
		const input = yield* readGitHubStatusInput(context.auth.organizationId).pipe(
			Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())),
		)
		return { status: deriveGitHubStatus(input), isAdmin: isOrganizationAdmin(context.auth) }
	},
)
