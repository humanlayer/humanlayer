import { Effect } from 'effect'

import { SlackIntegrationNotConfiguredError } from './slack.errors'
import type { SlackServiceShape } from './slack.types'

const failSlackNotConfigured = (operation: string) =>
	Effect.fail(new SlackIntegrationNotConfiguredError({ operation })).pipe(
		Effect.withSpan(`slack.${operation}`, { attributes: { slack_configured: false } }),
	)

/**
 * The Slack service for a deployment with no Slack app. It has the same methods as the real one,
 * so no caller checks whether Slack exists:
 * - `getStatus` reports an organization that never connected Slack;
 * - notification dispatch and interaction handling do nothing and report nothing, so a missing
 *   Slack app never turns a comment or artifact update into a Sentry report;
 * - every action a member starts fails with `SlackIntegrationNotConfiguredError`, which the
 *   procedures answer with "Slack is not set up on this deployment".
 */
export const unconfiguredSlackService: SlackServiceShape = {
	configured: false,
	createInstallUrl: () => failSlackNotConfigured('create_install_url'),
	exchangeCode: () => failSlackNotConfigured('exchange_code'),
	getStatus: () => Effect.succeed({ connected: false, enabled: false, needsReauth: false }),
	disconnect: () => failSlackNotConfigured('disconnect'),
	listChannels: () => failSlackNotConfigured('list_channels'),
	dispatchArtifactEvent: () => Effect.void,
	dispatchCommentEvent: () => Effect.void,
	verifyInteractionRequest: () => failSlackNotConfigured('verify_interaction_request'),
	handleInteractionPayload: () => Effect.void,
}
