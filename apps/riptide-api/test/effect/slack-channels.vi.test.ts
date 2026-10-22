import { randomUUID } from 'node:crypto'

import { it, layer } from '@effect/vitest'
import { organizations } from '@humanlayer/db/tables/organizations'
import { slackIntegrations } from '@humanlayer/db/tables/slack-integrations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Context, Effect, Layer, Predicate } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

type SlackChannelTestMode = 'success' | 'token-revoked' | 'malformed-response'

type SlackChannelsTestState = {
	db: PostgresJsDatabase
	organizationId: string
	mode: SlackChannelTestMode
	requests: Array<Record<string, unknown>>
	requestContentTypes: string[]
}

class SlackChannelsTest extends Context.Service<SlackChannelsTest, SlackChannelsTestState>()('SlackChannelsTest') {}

const configLayer = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		SLACK_CLIENT_ID: 'client-id',
		SLACK_CLIENT_SECRET: 'client-secret',
		SLACK_APP_ID: 'app-id',
		SLACK_SIGNING_SECRET: 'signing-secret',
		SLACK_API_BASE_URL: 'https://slack.test',
		SLACK_OAUTH_REDIRECT_URL: 'https://api.example.test/integrations/slack/callback',
		APP_ORIGIN: 'https://app.example.test',
	}),
)

const workosLayer = Layer.succeed(WorkosService, {
	...makeTestWorkosService(),
	listActiveAdmins: () => Effect.succeed([]),
	sendInvitation: () => Effect.die('sendInvitation not used'),
	getUser: ({ userId }) =>
		Effect.succeed({ userId, email: `${userId}@example.test`, firstName: null, lastName: null }),
	hasPendingInvitation: () => Effect.succeed(false),
	countActiveOrganizationMemberships: () => Effect.succeed(0),
	countPendingInvitations: () => Effect.succeed(0),
	listUsersByEmail: () => Effect.succeed([]),
	listActiveOrganizationMemberships: () => Effect.succeed([]),
})

const SlackChannelsTestLive = Layer.effect(
	SlackChannelsTest,
	Effect.acquireRelease(
		Effect.promise(() => requireExternalTestServices()).pipe(
			Effect.andThen(() => Effect.promise(() => createTestDb('slack_channels_service'))),
			Effect.flatMap(({ db, cleanup }) =>
				Effect.promise(() =>
					db
						.insert(organizations)
						.values({
							name: 'Slack channels service org',
							workos_organization_id: `workos-${randomUUID()}`,
						})
						.returning(),
				).pipe(
					Effect.flatMap(([organization]) =>
						organization === undefined
							? Effect.die('Failed to create organization')
							: Effect.promise(() =>
									db.insert(slackIntegrations).values({
										organization_id: organization.id,
										bot_access_token: 'xoxb-test',
										bot_user_id: 'U_BOT',
										scopes: 'channels:read,groups:read',
										connected_by_user_id: 'admin-1',
									}),
								).pipe(
									Effect.as({
										db,
										organizationId: organization.id,
										mode: 'success' as const,
										requests: [],
										requestContentTypes: [],
										cleanup,
									}),
								),
					),
				),
			),
		),
		({ cleanup }) => Effect.promise(cleanup),
	),
)

const SlackServiceTestLive = Layer.unwrap(
	Effect.map(SlackChannelsTest, (test) => {
		const httpClientLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					if (!url.pathname.endsWith('/api/conversations.list')) {
						return jsonResponse(request, { ok: false, error: 'unknown_method' }, 404)
					}

					const body = readRequestBody(request)
					test.requests.push(body)
					test.requestContentTypes.push(readRequestContentType(request))
					if (test.mode === 'token-revoked')
						return jsonResponse(request, { ok: false, error: 'token_revoked' })
					if (test.mode === 'malformed-response') {
						return jsonResponse(request, {
							ok: true,
							channels: [{ id: 'C_MALFORMED', name: 42, is_private: false }],
						})
					}

					return jsonResponse(
						request,
						body.cursor
							? {
									ok: true,
									channels: [{ id: 'G_PRIVATE', name: 'eng-private', is_private: true }],
									response_metadata: { next_cursor: '' },
								}
							: {
									ok: true,
									channels: [{ id: 'C_PUBLIC', name: 'general', is_private: false }],
									response_metadata: { next_cursor: 'page-2' },
								},
					)
				}),
			),
		)

		return Layer.mergeAll(SlackServiceLiveBase, PostgresDbLive(test.db), workosLayer).pipe(
			Layer.provide(Layer.mergeAll(configLayer, httpClientLayer)),
		)
	}),
)

const SlackChannelsLive = Layer.provideMerge(SlackServiceTestLive, SlackChannelsTestLive)

const resetSlackChannelTest = Effect.gen(function* () {
	const test = yield* SlackChannelsTest
	test.mode = 'success'
	test.requests = []
	test.requestContentTypes = []
	yield* Effect.promise(() =>
		test.db
			.update(slackIntegrations)
			.set({ needs_reauth: false, last_error_code: null })
			.where(eq(slackIntegrations.organization_id, test.organizationId)),
	)
})

layer(SlackChannelsLive)('Slack channel listing', (it) => {
	it.effect('paginates and normalizes public and private channels', () =>
		Effect.gen(function* () {
			yield* resetSlackChannelTest
			const test = yield* SlackChannelsTest
			const slack = yield* SlackService
			const channels = yield* slack.listChannels({ organizationId: test.organizationId })
			expect(channels).toEqual([
				{ id: 'C_PUBLIC', name: 'general', isPrivate: false },
				{ id: 'G_PRIVATE', name: 'eng-private', isPrivate: true },
			])
			expect(test.requests).toHaveLength(2)
			expect(test.requestContentTypes).toEqual([
				'application/x-www-form-urlencoded',
				'application/x-www-form-urlencoded',
			])
			expect(test.requests[0]).toMatchObject({
				types: 'public_channel,private_channel',
				limit: '200',
			})
			expect(test.requests[1]?.cursor).toBe('page-2')
		}),
	)

	it.effect('marks the integration as needing reauth on token failures', () =>
		Effect.gen(function* () {
			yield* resetSlackChannelTest
			const test = yield* SlackChannelsTest
			test.mode = 'token-revoked'

			const slack = yield* SlackService
			const error = yield* slack.listChannels({ organizationId: test.organizationId }).pipe(Effect.flip)
			expect(error._tag).toBe('SlackNeedsReauthError')

			const [integration] = yield* Effect.promise(() =>
				test.db
					.select()
					.from(slackIntegrations)
					.where(eq(slackIntegrations.organization_id, test.organizationId))
					.limit(1),
			)
			expect(integration).toMatchObject({ needs_reauth: true, last_error_code: 'SlackTokenRevokedError' })
		}),
	)

	it.effect('maps malformed channel payloads to an integration-unavailable error', () =>
		Effect.gen(function* () {
			yield* resetSlackChannelTest
			const test = yield* SlackChannelsTest
			test.mode = 'malformed-response'

			const slack = yield* SlackService
			const error = yield* slack.listChannels({ organizationId: test.organizationId }).pipe(Effect.flip)
			expect(error._tag).toBe('SlackIntegrationUnavailableError')
		}),
	)
})

const jsonResponse = (request: HttpClientRequest, body: unknown, status = 200) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
	)

const readRequestBody = (request: HttpClientRequest): Record<string, unknown> => {
	const body = request.body
	if (!Predicate.isTagged(body, 'Uint8Array')) return {}

	const text = new TextDecoder().decode(body.body)
	if (!text) return {}
	if (body.contentType.includes('application/json')) return JSON.parse(text) as Record<string, unknown>
	return Object.fromEntries(new URLSearchParams(text))
}

const readRequestContentType = (request: HttpClientRequest): string => {
	const body = request.body
	return Predicate.isTagged(body, 'Uint8Array') ? body.contentType : ''
}
