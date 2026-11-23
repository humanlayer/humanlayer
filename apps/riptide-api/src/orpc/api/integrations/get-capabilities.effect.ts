import { GitHubService } from '../../../effects/services/github/github.service'
import { ResendService } from '../../../effects/services/resend/resend.service'
import { SlackService } from '../../../effects/services/slack/slack.service'
import { StripeService } from '../../../effects/services/stripe/stripe.service'
import { classicServicesEffectMiddleware, effectOrpcBaseOrganizationRequired } from '../../effect-base'

/**
 * What this deployment supports. Every answer was decided at startup: the Effect services carry a
 * `configured` flag, and Jira and Linear are null in the classic services bag when their keys are
 * missing. Any organization member may ask.
 */
export const getIntegrationCapabilitiesProcedure = effectOrpcBaseOrganizationRequired.integrations.getCapabilities
	.use(classicServicesEffectMiddleware)
	.effect(function* ({ context }) {
		const slack = yield* SlackService
		const github = yield* GitHubService
		const stripe = yield* StripeService
		const resend = yield* ResendService

		return {
			slack: slack.configured,
			github: github.configured,
			jira: context.services.jira !== null,
			linear: context.services.linear !== null,
			billing: stripe.configured,
			email:
				resend.configured && resend.fromAddress !== null
					? { configured: true as const, fromAddress: resend.fromAddress }
					: { configured: false as const },
		}
	})
