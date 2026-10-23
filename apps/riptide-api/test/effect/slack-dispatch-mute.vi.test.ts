import { randomUUID } from 'node:crypto'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { Organization } from '@humanlayer/db/tables/organizations'
import { slackIntegrations } from '@humanlayer/db/tables/slack-integrations'
import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import type { SlackNotificationAutomation } from '@humanlayer/db/tables/slack-notification-automations'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { Task } from '@humanlayer/db/tables/tasks'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, ManagedRuntime, Predicate } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { type PostgresDb, PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { SlackService, SlackServiceLiveBase } from '../../src/effects/services/slack/slack.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { makeTestWorkosService } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const OWNER_USER_ID = 'owner-1'

describe('Slack dispatch mute', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let postedBodies: Array<Record<string, unknown>> = []
	let postCounter = 0
	let runtime: ManagedRuntime.ManagedRuntime<SlackService | PostgresDb | WorkosService, unknown>

	beforeAll(async () => {
		const testDb = await createTestDb('slack_dispatch_mute')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const configLayer = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				SLACK_CLIENT_ID: 'client-id',
				SLACK_CLIENT_SECRET: 'client-secret',
				SLACK_APP_ID: 'app-id',
				SLACK_SIGNING_SECRET: 'signing-secret',
				SLACK_API_BASE_URL: 'https://slack.test',
				SLACK_OAUTH_REDIRECT_URL: 'https://api.example.test/integrations/slack/callback',
				APP_ORIGIN: 'https://app.example.test',
				CLOUD_ORIGIN: 'https://cloud.example.test',
			}),
		)
		const httpClientLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					if (!url.pathname.endsWith('/api/chat.postMessage')) {
						return HttpClientResponse.fromWeb(
							request,
							new Response(JSON.stringify({ ok: false, error: 'unknown_method' }), { status: 404 }),
						)
					}

					postedBodies.push(readRequestBody(request))
					postCounter += 1
					return HttpClientResponse.fromWeb(
						request,
						new Response(JSON.stringify({ ok: true, ts: `111.${postCounter}` }), {
							status: 200,
							headers: { 'content-type': 'application/json' },
						}),
					)
				}),
			),
		)
		const workosLayer = Layer.succeed(WorkosService, {
			...makeTestWorkosService(),
			listActiveAdmins: () => Effect.succeed([]),
			sendInvitation: () => Effect.die('sendInvitation not used'),
			getUser: ({ userId }) =>
				Effect.succeed({ userId, email: `${userId}@example.test`, firstName: 'Ada', lastName: 'Lovelace' }),
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

	beforeEach(() => {
		postedBodies = []
		postCounter = 0
	})

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	it('skips an owner-filtered automation when the task owner muted Slack notifications', async () => {
		const seed = await seedSlackDispatchRows({
			eventTypes: ['structure-outline'],
			ownerUserIds: [OWNER_USER_ID],
		})
		await muteOwner(seed)

		await runtime.runPromise(dispatchArtifact(seed))

		expect(postedBodies).toHaveLength(0)
	})

	it('still posts an org-wide automation when the task owner muted Slack notifications', async () => {
		const seed = await seedSlackDispatchRows({
			eventTypes: ['structure-outline'],
			ownerUserIds: null,
		})
		await muteOwner(seed)

		await runtime.runPromise(dispatchArtifact(seed))

		expect(postedBodies).toHaveLength(1)
	})

	it('posts an owner-filtered automation when the owner has not muted', async () => {
		const seed = await seedSlackDispatchRows({
			eventTypes: ['structure-outline'],
			ownerUserIds: [OWNER_USER_ID],
		})

		await runtime.runPromise(dispatchArtifact(seed))

		expect(postedBodies).toHaveLength(1)
	})

	const seedSlackDispatchRows = async (input: {
		eventTypes: string[]
		ownerUserIds: string[] | null
	}): Promise<{ organization: Organization; task: Task; automation: SlackNotificationAutomation }> => {
		const [organization] = await db
			.insert(organizations)
			.values({ name: `Slack mute ${randomUUID()}`, workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create org')

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organization.id,
				created_by: 'actor-1',
				resource_owner_user_id: OWNER_USER_ID,
				name: 'Ship Slack notifications',
				slug: 'ship-slack-notifications',
			})
			.returning()
		if (!task) throw new Error('Failed to create task')

		await db
			.insert(organizationSettings)
			.values({ organization_id: organization.id, slack_integration_enabled: true })
		await db.insert(slackIntegrations).values({
			organization_id: organization.id,
			bot_access_token: 'xoxb-test',
			bot_user_id: 'U_BOT',
			scopes: 'chat:write',
			connected_by_user_id: 'admin-1',
		})

		const [automation] = await db
			.insert(slackNotificationAutomations)
			.values({
				organization_id: organization.id,
				name: 'Structure outline notifications',
				channel_id: 'C_TEST',
				channel_name: 'test-channel',
				channel_is_private: false,
				event_types: input.eventTypes,
				owner_user_ids: input.ownerUserIds,
				enabled: true,
				created_by_user_id: 'admin-1',
			})
			.returning()
		if (!automation) throw new Error('Failed to create automation')

		return { organization, task, automation }
	}

	// Slack mute is a task-level column now, so muting is a single update on the task row.
	const muteOwner = async (seed: { task: Task }) => {
		await db.update(tasks).set({ slack_notifications_muted: true }).where(eq(tasks.id, seed.task.id))
	}

	const dispatchArtifact = (seed: { organization: Organization; task: Task }) =>
		Effect.gen(function* () {
			const slack = yield* SlackService
			yield* slack.dispatchArtifactEvent({
				organizationId: seed.organization.id,
				taskId: seed.task.id,
				taskSlug: seed.task.slug,
				artifactId: randomUUID(),
				fileName: '07-structure-outline.md',
				artifactType: 'structure-outline',
				resourceOwnerUserId: OWNER_USER_ID,
				actorUserId: 'actor-1',
				created: true,
			})
		})
})

const readRequestBody = (request: HttpClientRequest): Record<string, unknown> => {
	const body = request.body
	if (!Predicate.isTagged(body, 'Uint8Array')) return {}

	const text = new TextDecoder().decode(body.body)
	if (!text) return {}
	if (body.contentType.includes('application/json')) return JSON.parse(text) as Record<string, unknown>
	return Object.fromEntries(new URLSearchParams(text))
}
