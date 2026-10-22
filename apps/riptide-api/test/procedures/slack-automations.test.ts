import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { slackNotificationAutomations } from '@humanlayer/db/tables/slack-notification-automations'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { SlackService } from '../../src/effects/services/slack/slack.service'
import { createSlackAutomationProcedure as liveCreateSlackAutomationProcedure } from '../../src/orpc/api/integrations/slack/create-automation.effect'
import { deleteSlackAutomationProcedure as liveDeleteSlackAutomationProcedure } from '../../src/orpc/api/integrations/slack/delete-automation.effect'
import { listSlackAutomationsProcedure as liveListSlackAutomationsProcedure } from '../../src/orpc/api/integrations/slack/list-automations.effect'
import { listSlackChannelsProcedure as liveListSlackChannelsProcedure } from '../../src/orpc/api/integrations/slack/list-channels.effect'
import { updateSlackAutomationProcedure as liveUpdateSlackAutomationProcedure } from '../../src/orpc/api/integrations/slack/update-automation.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

type SlackAutomationInput = {
	name: string
	channelId: string
	channelName: string | null
	channelIsPrivate: boolean
	eventTypes: Array<'design-discussion' | 'design-prd' | 'design-tdd' | 'structure-outline' | 'comment'>
	ownerUserIds: string[] | null
	enabled: boolean
}

describe('Slack automation procedures', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let otherOrganizationId: string
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>

	let createSlackAutomationProcedure: typeof liveCreateSlackAutomationProcedure
	let updateSlackAutomationProcedure: typeof liveUpdateSlackAutomationProcedure
	let deleteSlackAutomationProcedure: typeof liveDeleteSlackAutomationProcedure
	let listSlackAutomationsProcedure: typeof liveListSlackAutomationsProcedure
	let listSlackChannelsProcedure: typeof liveListSlackChannelsProcedure

	beforeAll(async () => {
		const testDb = await createTestDb('slack_automations')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'Slack automation test org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Failed to create test org')
		organizationId = org.id

		const [otherOrg] = await db
			.insert(organizations)
			.values({ name: 'Other Slack automation org', workos_organization_id: `workos-${randomUUID()}` })
			.returning()
		if (!otherOrg) throw new Error('Failed to create other test org')
		otherOrganizationId = otherOrg.id

		runtime = createRuntimeWithTestPostgresLayer(db, {
			slack: Layer.succeed(SlackService, {
				createInstallUrl: () => Effect.die('createInstallUrl not used'),
				exchangeCode: () => Effect.die('exchangeCode not used'),
				getStatus: () => Effect.die('getStatus not used'),
				disconnect: () => Effect.die('disconnect not used'),
				listChannels: () =>
					Effect.succeed([
						{ id: 'C_PUBLIC', name: 'general', isPrivate: false },
						{ id: 'G_PRIVATE', name: 'eng-private', isPrivate: true },
					]),
				dispatchArtifactEvent: () => Effect.void,
				dispatchCommentEvent: () => Effect.void,
				verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not used'),
				handleInteractionPayload: () => Effect.void,
			}),
		})

		createSlackAutomationProcedure = bindProcedureToRuntime(liveCreateSlackAutomationProcedure, runtime)
		updateSlackAutomationProcedure = bindProcedureToRuntime(liveUpdateSlackAutomationProcedure, runtime)
		deleteSlackAutomationProcedure = bindProcedureToRuntime(liveDeleteSlackAutomationProcedure, runtime)
		listSlackAutomationsProcedure = bindProcedureToRuntime(liveListSlackAutomationsProcedure, runtime)
		listSlackChannelsProcedure = bindProcedureToRuntime(liveListSlackChannelsProcedure, runtime)
	}, 60000)

	afterAll(async () => {
		await runtime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const makeContext = (role: 'admin' | 'member' = 'admin') =>
		createMockApiContext({
			auth: createMockApiAuth({
				role,
				roles: [role],
				organizationId,
				workosOrganizationId: `workos-${organizationId}`,
			}),
			services: { db, dbReadReplica: db },
		})

	async function createAutomation(overrides?: Partial<SlackAutomationInput>) {
		return call(
			createSlackAutomationProcedure,
			{
				name: `Automation ${randomUUID()}`,
				channelId: 'C_PUBLIC',
				channelName: 'general',
				channelIsPrivate: false,
				eventTypes: ['design-discussion', 'comment'],
				ownerUserIds: null,
				enabled: true,
				...overrides,
			},
			{ context: makeContext() },
		)
	}

	test('requires admin access for automation mutations and channel listing', async () => {
		const memberContext = makeContext('member')

		await expect(
			call(
				createSlackAutomationProcedure,
				{
					name: 'Member automation',
					channelId: 'C_PUBLIC',
					channelName: 'general',
					channelIsPrivate: false,
					eventTypes: ['comment'],
					ownerUserIds: null,
					enabled: true,
				},
				{ context: memberContext },
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		await expect(call(listSlackChannelsProcedure, {}, { context: memberContext })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
	})

	test('lists channels from SlackService', async () => {
		const result = await call(listSlackChannelsProcedure, {}, { context: makeContext() })

		expect(result.channels).toEqual([
			{ id: 'C_PUBLIC', name: 'general', isPrivate: false },
			{ id: 'G_PRIVATE', name: 'eng-private', isPrivate: true },
		])
	})

	test('creates, lists, updates, and deletes automations scoped to the caller organization', async () => {
		await db.insert(slackNotificationAutomations).values({
			organization_id: otherOrganizationId,
			created_by_user_id: 'other-user',
			name: 'Other org automation',
			channel_id: 'C_OTHER',
			channel_name: 'other',
			channel_is_private: false,
			event_types: ['comment'],
			owner_user_ids: null,
			enabled: true,
		})

		const created = await createAutomation({ ownerUserIds: ['owner-1'], enabled: true })

		expect(created.channelName).toBe('general')
		expect(created.ownerUserIds).toEqual(['owner-1'])

		const [createdRow] = await db
			.select()
			.from(slackNotificationAutomations)
			.where(eq(slackNotificationAutomations.id, created.id))
			.limit(1)
		expect(createdRow?.organization_id).toBe(organizationId)

		const listResult = await call(listSlackAutomationsProcedure, {}, { context: makeContext() })
		expect(listResult.automations.map((automation) => automation.id)).toContain(created.id)
		expect(listResult.automations.some((automation) => automation.channelId === 'C_OTHER')).toBe(false)

		const updated = await call(
			updateSlackAutomationProcedure,
			{
				id: created.id,
				name: 'Updated automation',
				channelId: 'G_PRIVATE',
				channelName: 'eng-private',
				channelIsPrivate: true,
				eventTypes: ['structure-outline'],
				ownerUserIds: null,
				enabled: false,
			},
			{ context: makeContext() },
		)

		expect(updated.name).toBe('Updated automation')
		expect(updated.channelIsPrivate).toBe(true)
		expect(updated.eventTypes).toEqual(['structure-outline'])
		expect(updated.enabled).toBe(false)

		await call(deleteSlackAutomationProcedure, { id: created.id }, { context: makeContext() })

		const [deletedRow] = await db
			.select()
			.from(slackNotificationAutomations)
			.where(eq(slackNotificationAutomations.id, created.id))
			.limit(1)
		expect(deletedRow).toBeUndefined()
	})
})
