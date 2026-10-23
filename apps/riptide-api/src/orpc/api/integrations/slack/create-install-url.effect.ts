import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const createSlackInstallUrlProcedure =
	effectOrpcBaseForOrganizationAdmin.integrations.slack.createInstallUrl.effect(function* ({ context, errors }) {
		const slack = yield* SlackService
		return yield* slack
			.createInstallUrl({ organizationId: context.auth.organizationId, requestedByUserId: context.auth.userId })
			.pipe(Effect.catchTag('SlackIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())))
	})
