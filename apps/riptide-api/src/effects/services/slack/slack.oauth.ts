import { Effect, Redacted } from 'effect'

import { SlackOAuthError } from './slack.errors'
import type {
	BuildSlackInstallUrlInput,
	SlackConnectionFromOAuthResponseInput,
	SlackConnectionFromOAuthResponseResult,
} from './slack.types'

export const slackOAuthRedirectUrlFromApiOrigin = (apiOrigin: URL): URL => {
	const url = new URL(apiOrigin.href)
	url.pathname = '/integrations/slack/callback'
	url.search = ''
	url.hash = ''
	return url
}

export const buildInstallUrl = (input: BuildSlackInstallUrlInput): string => {
	const url = new URL('/oauth/v2/authorize', input.slackApiBaseUrl)
	url.searchParams.set('client_id', input.clientId)
	url.searchParams.set('scope', input.scopes)
	url.searchParams.set('redirect_uri', input.oauthRedirectUrl)
	url.searchParams.set('state', input.state)
	return url.toString()
}

/**
 * Converts the parsed Slack OAuth access response into the connection row we persist.
 * The response comes from the local oauth.v2.access schema, so fields
 * are already decoded and token values are Redacted until we cross the database boundary.
 */
export const slackConnectionFromOAuthResponse = (
	input: SlackConnectionFromOAuthResponseInput,
): Effect.Effect<SlackConnectionFromOAuthResponseResult, SlackOAuthError> =>
	Effect.gen(function* () {
		const accessToken = input.response.access_token
		const botUserId = input.response.bot_user_id
		if (!accessToken || !botUserId) {
			return yield* Effect.fail(new SlackOAuthError({ code: input.response.error, cause: input.response }))
		}

		const teamId = input.response.team?.id ?? null
		const teamName = input.response.team?.name ?? null
		const responseAppId = input.response.app_id ?? null

		return {
			connection: {
				organizationId: input.organizationId,
				connectedByUserId: input.connectedByUserId,
				botAccessToken: Redacted.value(accessToken),
				botUserId,
				scopes: input.response.scope ?? input.scopes,
				teamId,
				teamName,
				appId: responseAppId ?? input.appId,
			},
			teamName,
		}
	})
