import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import { buildInstallUrl, slackOAuthRedirectUrlFromApiOrigin } from '../../src/effects/services/slack/slack.oauth'
import { SlackOAuthAccessResponseSchema } from '../../src/effects/services/slack/slack.schema'

const oauthAccessDecoder = SlackOAuthAccessResponseSchema

const slackOAuthResponse = {
	ok: true,
	app_id: 'A123',
	authed_user: { id: 'U123' },
	scope: 'chat:write,channels:read',
	token_type: 'bot',
	access_token: 'xoxb-token',
	bot_user_id: 'U456',
	team: { id: 'T123', name: 'HumanLayer' },
	enterprise: null,
	is_enterprise_install: false,
}

describe('Slack OAuth schemas', () => {
	it('accepts non-enterprise Slack OAuth responses with enterprise null', () => {
		expect(() => Schema.decodeUnknownSync(oauthAccessDecoder)(slackOAuthResponse)).not.toThrow()
	})
})

describe('Slack OAuth redirect URL defaults', () => {
	it('derives the callback URL from the API origin', () => {
		expect(slackOAuthRedirectUrlFromApiOrigin(new URL('https://riptide-api.example.com')).toString()).toBe(
			'https://riptide-api.example.com/integrations/slack/callback',
		)
	})

	it('derives the install URL from the configured Slack API base URL', () => {
		const url = new URL(
			buildInstallUrl({
				slackApiBaseUrl: 'https://slack-api.test',
				clientId: '123.456',
				scopes: 'chat:write,channels:read',
				oauthRedirectUrl: 'https://api.example.com/integrations/slack/callback',
				state: 'state-123',
			}),
		)

		expect(url.origin).toBe('https://slack-api.test')
		expect(url.pathname).toBe('/oauth/v2/authorize')
		expect(url.searchParams.get('client_id')).toBe('123.456')
		expect(url.searchParams.get('scope')).toBe('chat:write,channels:read')
		expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.com/integrations/slack/callback')
		expect(url.searchParams.get('state')).toBe('state-123')
	})
})
