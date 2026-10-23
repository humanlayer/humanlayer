import { randomUUID } from 'node:crypto'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { slackIntegrationInstallStates } from '@humanlayer/db/tables/slack-integration-install-states'
import { slackIntegrations } from '@humanlayer/db/tables/slack-integrations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, ManagedRuntime, Predicate } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { SlackInstallStateInvalidError } from '../../src/effects/services/slack/slack.errors'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Slack connect service', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let runtime: ManagedRuntime.ManagedRuntime<SlackService | PostgresDb | WorkosService, unknown>
	let oauthRequests: Array<Record<string, unknown>> = []

	beforeAll(async () => {
		const testDb = await createTestDb('slack_connect_service')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Slack connect service org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create organization')
		organizationId = organization.id

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
		const httpClientLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					if (!url.pathname.endsWith('/api/oauth.v2.access')) {
						return jsonResponse(request, { ok: false, error: 'unknown_method' }, 404)
					}

					oauthRequests.push(readRequestBody(request))
					return jsonResponse(request, {
						ok: true,
						app_id: 'A123',
						scope: 'chat:write,channels:read',
						access_token: 'xoxb-connected',
						bot_user_id: 'U_BOT',
						team: { id: 'T123', name: 'HumanLayer' },
					})
				}),
			),
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

		runtime = ManagedRuntime.make(
			Layer.mergeAll(SlackServiceLiveBase, PostgresDbLive(db), workosLayer).pipe(
				Layer.provide(Layer.mergeAll(configLayer, httpClientLayer)),
			),
		)
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	it('creates an install state and exchanges it into a connected Slack integration', async () => {
		oauthRequests = []
		const install = await runtime.runPromise(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			}),
		)
		const installUrl = new URL(install.url)
		const state = installUrl.searchParams.get('state')
		expect(state).toBeTruthy()
		expect(installUrl.searchParams.get('client_id')).toBe('client-id')
		expect(installUrl.searchParams.get('redirect_uri')).toBe('https://api.example.test/integrations/slack/callback')

		const [stateRow] = await db.select().from(slackIntegrationInstallStates).limit(1)
		expect(stateRow?.state_token_hash).toBeTruthy()
		expect(stateRow?.state_token_hash).not.toBe(state)

		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.exchangeCode({ code: 'oauth-code', state: state! })
			}),
		)

		expect(result.teamName).toBe('HumanLayer')
		expect(oauthRequests[0]).toMatchObject({
			client_id: 'client-id',
			client_secret: 'client-secret',
			code: 'oauth-code',
			redirect_uri: 'https://api.example.test/integrations/slack/callback',
		})

		const [integration] = await db
			.select()
			.from(slackIntegrations)
			.where(eq(slackIntegrations.organization_id, organizationId))
			.limit(1)
		expect(integration).toMatchObject({
			bot_user_id: 'U_BOT',
			slack_team_name: 'HumanLayer',
			needs_reauth: false,
		})

		const [settings] = await db
			.select()
			.from(organizationSettings)
			.where(eq(organizationSettings.organization_id, organizationId))
			.limit(1)
		expect(settings?.slack_integration_enabled).toBe(true)
		const [consumedState] = await db.select().from(slackIntegrationInstallStates).limit(1)
		expect(consumedState?.consumed_at).toBeTruthy()
	})

	it('rejects a reused OAuth state before calling Slack', async () => {
		const install = await runtime.runPromise(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.createInstallUrl({ organizationId, requestedByUserId: 'admin-1' })
			}),
		)
		const state = new URL(install.url).searchParams.get('state')!

		await runtime.runPromise(
			Effect.gen(function* () {
				const slack = yield* SlackService
				return yield* slack.exchangeCode({ code: 'first-code', state })
			}),
		)

		await expect(
			runtime.runPromise(
				Effect.gen(function* () {
					const slack = yield* SlackService
					return yield* slack.exchangeCode({ code: 'second-code', state })
				}),
			),
		).rejects.toBeInstanceOf(SlackInstallStateInvalidError)
	})
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
