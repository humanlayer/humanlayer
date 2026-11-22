import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const createSlackInstallUrlProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.createInstallUrl.effect(function* ({ context, errors }) {
		const slack = yield* SlackService
		return yield* slack
			.createInstallUrl({ organizationId: context.auth.organizationId, requestedByUserId: context.auth.userId })
			.pipe(
				Effect.catchTags({
					SlackIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
					SlackIntegrationNotConfiguredError: () =>
						Effect.fail(
							errors.BAD_REQUEST({ data: { message: 'Slack is not set up on this deployment' } }),
						),
				}),
			)
	})
