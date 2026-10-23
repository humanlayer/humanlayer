import { randomUUID } from 'node:crypto'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { Organization } from '@humanlayer/db/tables/organizations'
import { slackIntegrations } from '@humanlayer/db/tables/slack-integrations'
import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import type { SlackNotificationAutomation } from '@humanlayer/db/tables/slack-notification-automations'
import { slackNotificationThreads } from '@humanlayer/db/tables/slack-notification-threads'
import { tasks } from '@humanlayer/db/tables/tasks'
import type { Task } from '@humanlayer/db/tables/tasks'
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

describe('Slack dispatch threading', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let postedBodies: Array<Record<string, unknown>> = []
	let postCounter = 0
	let runtime: ManagedRuntime.ManagedRuntime<SlackService | PostgresDb | WorkosService, unknown>

	beforeAll(async () => {
		const testDb = await createTestDb('slack_dispatch_threading')
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
				Effect.succeed({
					userId,
					email: `${userId}@example.test`,
					firstName: userId === 'commenter-1' ? 'Grace' : 'Ada',
					lastName: userId === 'commenter-1' ? 'Hopper' : 'Lovelace',
				}),
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

	it('posts later artifact events into the stored task thread with broadcast', async () => {
		const seed = await seedSlackDispatchRows({ eventTypes: ['structure-outline'] })

		await runtime.runPromise(dispatchArtifact(seed, randomUUID()))
		await runtime.runPromise(dispatchArtifact(seed, randomUUID()))

		expect(postedBodies).toHaveLength(2)
		expect(postedBodies[1]).toMatchObject({ thread_ts: '111.1', reply_broadcast: true })

		// The root leads with the linked task title; the threaded reply is one descriptor block whose
		// filename links to the artifact.
		const rootTexts = blockTexts(postedBodies[0])
		expect(rootTexts[0]).toMatch(/^\*Task:\* \*<[^|>]+\|Ship Slack notifications>\*$/)
		const reply = postedBodies[1]?.blocks as Array<Record<string, unknown>>
		expect(reply).toHaveLength(1)
		expect(blockTexts(postedBodies[1])[0]).toMatch(
			/^🟦 New Structure Outline · Ada Lovelace\n<[^|>]+\|07-structure-outline\.md>$/,
		)
		expect(linkLabels(postedBodies[1])).toEqual(['07-structure-outline.md'])
	})

	it('posts comment events into an existing task thread without broadcast', async () => {
		const seed = await seedSlackDispatchRows({ eventTypes: ['comment'] })
		await seedReadyThread(seed, '222.1')

		await runtime.runPromise(dispatchComment(seed, { commenterUserId: 'commenter-1' }))

		expect(postedBodies).toHaveLength(1)
		expect(postedBodies[0]).toMatchObject({ thread_ts: '222.1', reply_broadcast: false })

		// Comment replies stay lean: descriptor with the filename linked to the comment + quoted
		// comment preview, no task title.
		const reply = postedBodies[0]?.blocks as Array<Record<string, unknown>>
		expect(reply).toHaveLength(2)
		expect(blockTexts(postedBodies[0])[0]).toMatch(
			/^🟩 \*Grace Hopper commented on\*\n<[^|>]+\|07-structure-outline\.md>$/,
		)
		expect(blockTexts(postedBodies[0])[1]).toBe('> This is a threaded comment.')
		expect(blockTexts(postedBodies[0]).join('\n')).not.toContain('Ship Slack notifications')
		expect(linkLabels(postedBodies[0])).toEqual(['07-structure-outline.md'])
	})

	it('posts comments by non-owners when the artifact owner matches the automation filter', async () => {
		const seed = await seedSlackDispatchRows({ eventTypes: ['comment'], ownerUserIds: ['owner-1'] })
		await seedReadyThread(seed, '333.1')

		await runtime.runPromise(dispatchComment(seed, { commenterUserId: 'commenter-1' }))

		expect(postedBodies).toHaveLength(1)
		expect(postedBodies[0]).toMatchObject({ thread_ts: '333.1', reply_broadcast: false })
	})

	const seedSlackDispatchRows = async (input: {
		eventTypes: string[]
		ownerUserIds?: string[] | null
	}): Promise<{ organization: Organization; task: Task; automation: SlackNotificationAutomation }> => {
		const [organization] = await db
			.insert(organizations)
			.values({ name: `Slack threading ${randomUUID()}`, workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!organization) throw new Error('Failed to create org')

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organization.id,
				created_by: 'actor-1',
				resource_owner_user_id: 'owner-1',
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
				name: 'Threaded notifications',
				channel_id: 'C_TEST',
				channel_name: 'test-channel',
				channel_is_private: false,
				event_types: input.eventTypes,
				owner_user_ids: input.ownerUserIds ?? null,
				enabled: true,
				created_by_user_id: 'admin-1',
			})
			.returning()
		if (!automation) throw new Error('Failed to create automation')

		return { organization, task, automation }
	}

	const seedReadyThread = async (
		seed: { organization: Organization; task: Task; automation: SlackNotificationAutomation },
		ts: string,
	) => {
		await db.insert(slackNotificationThreads).values({
			organization_id: seed.organization.id,
			automation_id: seed.automation.id,
			task_id: seed.task.id,
			channel_id: 'C_TEST',
			root_thread_ts: ts,
			root_message_ts: ts,
			status: 'ready',
		})
	}

	const dispatchArtifact = (seed: { organization: Organization; task: Task }, artifactId: string) =>
		Effect.gen(function* () {
			const slack = yield* SlackService
			yield* slack.dispatchArtifactEvent({
				organizationId: seed.organization.id,
				taskId: seed.task.id,
				taskSlug: seed.task.slug,
				artifactId,
				fileName: '07-structure-outline.md',
				artifactType: 'structure-outline',
				resourceOwnerUserId: 'owner-1',
				actorUserId: 'actor-1',
				created: true,
			})
		})

	const dispatchComment = (seed: { organization: Organization; task: Task }, input: { commenterUserId: string }) =>
		Effect.gen(function* () {
			const slack = yield* SlackService
			yield* slack.dispatchCommentEvent({
				organizationId: seed.organization.id,
				taskId: seed.task.id,
				taskSlug: seed.task.slug,
				artifactId: randomUUID(),
				fileName: '07-structure-outline.md',
				commentId: randomUUID(),
				resourceOwnerUserId: 'owner-1',
				commenterUserId: input.commenterUserId,
				contentText: 'This is a threaded comment.',
			})
		})
})

const blockTexts = (body: Record<string, unknown> | undefined): string[] =>
	((body?.blocks as Array<{ text?: { text?: string } }> | undefined) ?? []).map((block) => block.text?.text ?? '')

const linkLabels = (body: Record<string, unknown> | undefined): string[] =>
	blockTexts(body).flatMap((text) => [...text.matchAll(/<[^|>]+\|([^>]+)>/g)].map((match) => match[1] ?? ''))

const readRequestBody = (request: HttpClientRequest): Record<string, unknown> => {
	const body = request.body
	if (!Predicate.isTagged(body, 'Uint8Array')) return {}

	const text = new TextDecoder().decode(body.body)
	if (!text) return {}
	if (body.contentType.includes('application/json')) return JSON.parse(text) as Record<string, unknown>
	return Object.fromEntries(new URLSearchParams(text))
}
