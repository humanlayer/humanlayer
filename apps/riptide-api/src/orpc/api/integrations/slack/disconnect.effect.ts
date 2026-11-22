import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const disconnectSlackProcedure = effectOrpcBaseForOrganizationAdmin.integrations.slack.disconnect.effect(
	function* ({ context, errors }) {
		const slack = yield* SlackService
		yield* slack.disconnect({ organizationId: context.auth.organizationId }).pipe(
			Effect.catchTags({
				SlackIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				SlackIntegrationNotConfiguredError: () =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack is not set up on this deployment' } })),
			}),
		)
		return { success: true }
	},
)
