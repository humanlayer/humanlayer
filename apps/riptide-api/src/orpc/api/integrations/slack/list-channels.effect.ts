import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const listSlackChannelsProcedure = effectOrpcBaseForOrganizationAdmin.integrations.slack.listChannels.effect(
	function* ({ context, errors }) {
		const slack = yield* SlackService
		const channels = yield* slack.listChannels({ organizationId: context.auth.organizationId }).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				SlackNotConnectedError: () =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack is not connected' } })),
				SlackNeedsReauthError: () =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack needs reconnection' } })),
				SlackIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
		return { channels: channels.map((channel) => ({ ...channel })) }
	},
)
