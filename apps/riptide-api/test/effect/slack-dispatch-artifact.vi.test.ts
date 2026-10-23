import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { slackIntegrations } from '@humanlayer/db/tables/slack-integrations'
import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { slackNotificationThreads } from '@humanlayer/db/tables/slack-notification-threads'
import { tasks } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, ManagedRuntime } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { artifactTypeToSlackEventType } from '../../src/effects/services/slack/format'
import { SlackService, SlackServiceLive } from '../../src/effects/services/slack/slack.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Slack artifact dispatch', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let slackServer: Server
	let slackServerPort: number
	let slackResponse: unknown = { ok: true, ts: '111.1' }
	let postedBodies: Array<Record<string, unknown>> = []
	let runtime: ManagedRuntime.ManagedRuntime<SlackService | PostgresDb | WorkosService, unknown>

	beforeAll(async () => {
		const testDb = await createTestDb('slack_dispatch_artifact')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		slackServer = await startSlackServer(async (path, body) => {
			if (path.endsWith('/api/chat.postMessage')) {
				postedBodies.push(body)
				return { status: 200, body: slackResponse }
			}
			return { status: 404, body: { ok: false, error: 'unknown_method' } }
		})
		const address = slackServer.address()
		if (!address || typeof address === 'string') throw new Error('Slack test server did not bind a port')
		slackServerPort = address.port

		const configLayer = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				SLACK_CLIENT_ID: 'client-id',
				SLACK_CLIENT_SECRET: 'client-secret',
				SLACK_APP_ID: 'app-id',
				SLACK_SIGNING_SECRET: 'signing-secret',
				SLACK_API_BASE_URL: `http://127.0.0.1:${slackServerPort}`,
				SLACK_OAUTH_REDIRECT_URL: 'https://api.example.test/integrations/slack/callback',
				APP_ORIGIN: 'https://app.example.test',
				CLOUD_ORIGIN: 'https://cloud.example.test',
			}),
		)

		const workosLayer = Layer.succeed(WorkosService, {
			...makeTestWorkosService(),
			listActiveAdmins: () => Effect.succeed([]),
			sendInvitation: () => Effect.die('sendInvitation not used'),
			getUser: ({ userId }) =>
				Effect.succeed({ userId, email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace' }),
			hasPendingInvitation: () => Effect.succeed(false),
			countActiveOrganizationMemberships: () => Effect.succeed(0),
			countPendingInvitations: () => Effect.succeed(0),
			listUsersByEmail: () => Effect.succeed([]),
			listActiveOrganizationMemberships: () => Effect.succeed([]),
		})

		runtime = ManagedRuntime.make(
			Layer.mergeAll(SlackServiceLive, PostgresDbLive(db), workosLayer).pipe(Layer.provide(configLayer)),
		)
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
		await new Promise<void>((resolve) => slackServer?.close(() => resolve()))
	}, 30000)

	it('maps artifact frontmatter types to Slack automation event types', () => {
		expect(artifactTypeToSlackEventType('design-discussion')).toBe('design-discussion')
		expect(artifactTypeToSlackEventType('structure-outline')).toBe('structure-outline')
		expect(artifactTypeToSlackEventType('unknown')).toBeNull()
	})

	it('posts a top-level artifact notification and stores the Slack thread timestamp', async () => {
		postedBodies = []
		slackResponse = { ok: true, ts: '111.1' }
		const seed = await seedSlackDispatchRows({ eventTypes: ['structure-outline'] })

		await runtime.runPromise(dispatchArtifact(seed))

		expect(postedBodies).toHaveLength(1)
		expect(postedBodies[0]).toMatchObject({ unfurl_links: false, unfurl_media: false })

		const [thread] = await db
			.select()
			.from(slackNotificationThreads)
			.where(eq(slackNotificationThreads.automation_id, seed.automationId))
			.limit(1)
		expect(thread).toMatchObject({ root_thread_ts: '111.1', root_message_ts: '111.1', status: 'ready' })
	})

	it('marks the integration as needing reauth when Slack reports token_revoked', async () => {
		postedBodies = []
		slackResponse = { ok: false, error: 'token_revoked' }
		const seed = await seedSlackDispatchRows({ eventTypes: ['structure-outline'] })

		await runtime.runPromise(dispatchArtifact(seed))

		const [integration] = await db
			.select()
			.from(slackIntegrations)
			.where(eq(slackIntegrations.organization_id, seed.organizationId))
			.limit(1)
		expect(integration).toMatchObject({ needs_reauth: true, last_error_code: 'token_revoked' })
	})

	it('does not fail dispatch or require reauth on channel errors, and releases the claim', async () => {
		postedBodies = []
		slackResponse = { ok: false, error: 'not_in_channel' }
		const seed = await seedSlackDispatchRows({ eventTypes: ['structure-outline'] })

		// A channel-scoped failure must not fail dispatch and must not escalate to a connection reauth.
		await runtime.runPromise(dispatchArtifact(seed))

		const [integration] = await db
			.select()
			.from(slackIntegrations)
			.where(eq(slackIntegrations.organization_id, seed.organizationId))
			.limit(1)
		expect(integration).toMatchObject({ needs_reauth: false })

		// The claimed root row is released rather than stranded, so a later event can retry the channel.
		const threads = await db
			.select()
			.from(slackNotificationThreads)
			.where(eq(slackNotificationThreads.automation_id, seed.automationId))
		expect(threads).toHaveLength(0)
	})

	it('releases the thread claim when the root post fails, so a later event re-creates it', async () => {
		postedBodies = []
		slackResponse = { ok: false, error: 'invalid_arguments' }
		const seed = await seedSlackDispatchRows({ eventTypes: ['structure-outline'] })

		// Root post fails: the claimed `pending` row must be released, not left behind to deadlock
		// every future artifact/comment for this task on "Slack thread root is pending".
		await runtime.runPromise(dispatchArtifact(seed))
		expect(postedBodies).toHaveLength(1)

		const afterFailure = await db
			.select()
			.from(slackNotificationThreads)
			.where(eq(slackNotificationThreads.automation_id, seed.automationId))
		expect(afterFailure).toHaveLength(0)

		// A later event re-claims cleanly and publishes a fresh top-level root (no stale thread_ts).
		postedBodies = []
		slackResponse = { ok: true, ts: '999.1' }
		await runtime.runPromise(dispatchArtifact(seed))

		expect(postedBodies).toHaveLength(1)
		expect(postedBodies[0]?.thread_ts).toBeUndefined()
		const [recovered] = await db
			.select()
			.from(slackNotificationThreads)
			.where(eq(slackNotificationThreads.automation_id, seed.automationId))
			.limit(1)
		expect(recovered).toMatchObject({ root_thread_ts: '999.1', status: 'ready' })
	})

	async function seedSlackDispatchRows(input: { eventTypes: string[] }) {
		const [org] = await db
			.insert(organizations)
			.values({ name: `Slack dispatch ${randomUUID()}`, workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Failed to create org')

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: org.id,
				created_by: 'actor-1',
				resource_owner_user_id: 'owner-1',
				name: 'Ship Slack notifications',
				slug: 'ship-slack-notifications',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		await db.insert(organizationSettings).values({ organization_id: org.id, slack_integration_enabled: true })
		await db.insert(slackIntegrations).values({
			organization_id: org.id,
			bot_access_token: 'xoxb-test',
			bot_user_id: 'U_BOT',
			scopes: 'chat:write',
			connected_by_user_id: 'admin-1',
		})

		const [automation] = await db
			.insert(slackNotificationAutomations)
			.values({
				organization_id: org.id,
				name: 'Structure outline notifications',
				channel_id: 'C_TEST',
				channel_name: 'test-channel',
				channel_is_private: false,
				event_types: input.eventTypes,
				owner_user_ids: null,
				enabled: true,
				created_by_user_id: 'admin-1',
			})
			.returning()
		if (!automation) throw new Error('Failed to create automation')

		return { organizationId: org.id, taskId: task.id, automationId: automation.id }
	}

	function dispatchArtifact(seed: { organizationId: string; taskId: string }) {
		return Effect.gen(function* () {
			const slack = yield* SlackService
			yield* slack.dispatchArtifactEvent({
				organizationId: seed.organizationId,
				taskId: seed.taskId,
				taskSlug: 'ship-slack-notifications',
				artifactId: randomUUID(),
				fileName: '07-structure-outline.md',
				artifactType: 'structure-outline',
				resourceOwnerUserId: 'owner-1',
				actorUserId: 'actor-1',
				created: true,
			})
		})
	}
})

function startSlackServer(
	handle: (path: string, body: Record<string, unknown>) => Promise<{ status: number; body: unknown }>,
) {
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = []
		for await (const chunk of request) chunks.push(Buffer.from(chunk))
		const rawBody = Buffer.concat(chunks).toString('utf8')
		const parsedBody = parseRequestBody(rawBody, request.headers['content-type'])
		const url = new URL(request.url ?? '/', 'http://localhost')
		const parsedInput = { ...Object.fromEntries(url.searchParams), ...parsedBody }
		const result = await handle(url.pathname, parsedInput)
		response.writeHead(result.status, { 'content-type': 'application/json' })
		response.end(JSON.stringify(result.body))
	})

	return new Promise<Server>((resolve) => {
		server.listen(0, '127.0.0.1', () => resolve(server))
	})
}

function parseRequestBody(rawBody: string, contentType: string | undefined): Record<string, unknown> {
	if (!rawBody) return {}
	if (contentType?.includes('application/json')) return JSON.parse(rawBody) as Record<string, unknown>
	return Object.fromEntries(new URLSearchParams(rawBody))
}
