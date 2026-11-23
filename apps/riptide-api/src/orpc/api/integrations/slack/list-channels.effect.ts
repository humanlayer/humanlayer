import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

const captureSlackChannelListFailure = (error: unknown) =>
	Effect.logError(error).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(error))))

export const listSlackChannelsProcedure = effectOrpcBaseForOrganizationAdmin.integrations.slack.listChannels.effect(
	function* ({ context, errors }) {
		const slack = yield* SlackService
		const channels = yield* slack.listChannels({ organizationId: context.auth.organizationId }).pipe(
			Effect.catchTags({
				// Not a failure: this deployment has no Slack app, so nothing is captured.
				SlackIntegrationNotConfiguredError: () =>
					Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack is not set up on this deployment' } })),
				SlackNotConnectedError: (error) =>
					captureSlackChannelListFailure(error).pipe(
						Effect.andThen(
							Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack is not connected' } })),
						),
					),
				SlackNeedsReauthError: (error) =>
					captureSlackChannelListFailure(error).pipe(
						Effect.andThen(
							Effect.fail(errors.BAD_REQUEST({ data: { message: 'Slack needs reconnection' } })),
						),
					),
				SlackIntegrationUnavailableError: (error) =>
					captureSlackChannelListFailure(error).pipe(
						Effect.andThen(Effect.fail(errors.SERVICE_UNAVAILABLE())),
					),
			}),
		)
		return { channels: channels.map((channel) => ({ ...channel })) }
	},
)
