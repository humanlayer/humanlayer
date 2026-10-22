import { Effect } from 'effect'

import { SlackService } from '../../../../effects/services/slack/slack.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getSlackStatusProcedure = effectOrpcBaseOrganizationRequired.integrations.slack.getStatus.effect(
	function* ({ context, errors }) {
		const slack = yield* SlackService
		const status = yield* slack
			.getStatus({ organizationId: context.auth.organizationId })
			.pipe(Effect.catchTag('SlackIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())))
		return {
			connected: status.connected,
			enabled: status.enabled,
			needsReauth: status.needsReauth,
			teamName: status.teamName ?? null,
			lastErrorCode: status.lastErrorCode ?? null,
		}
	},
)
