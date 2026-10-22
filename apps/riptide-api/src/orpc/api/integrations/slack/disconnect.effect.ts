import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const disconnectSlackProcedure = effectOrpcBaseForOrganizationAdmin.integrations.slack.disconnect.effect(
	function* ({ context, errors }) {
		const slack = yield* SlackService
		yield* slack
			.disconnect({ organizationId: context.auth.organizationId })
			.pipe(Effect.catchTag('SlackIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())))
		return { success: true }
	},
)
