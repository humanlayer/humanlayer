import { randomUUID } from 'node:crypto'

import { accessRequests } from '@humanlayer/db/tables/access-requests'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { IStripeService } from '../../src/lib/stripe-service'
import type { WorkosEvent, WorkosSdkAdapter } from '../../src/lib/workos-service'
import { createMockStripeService, createMockWorkosService } from '../mocks'
import { createApp } from '../test-factory'
import { createTestDb } from '../utils/test-db'

let db: PostgresJsDatabase
let cleanupTestDb: (() => Promise<void>) | undefined

beforeAll(async () => {
	const testDb = await createTestDb('workos_webhook')
	cleanupTestDb = testDb.cleanup
	db = testDb.db
})

afterAll(async () => {
	await cleanupTestDb?.()
	cleanupTestDb = undefined
})

async function insertOrganization() {
	const [organization] = await db
		.insert(organizations)
		.values({
			name: 'WorkOS Webhook Org',
			workos_organization_id: 'workos_org_webhook',
			stripe_customer_id: 'cus_webhook',
		})
		.returning()

	if (!organization) {
		throw new Error('Failed to insert test organization')
	}

	return organization
}

function buildMembershipEvent(eventType = 'organization_membership.updated'): WorkosEvent {
	return {
		id: 'event_workos_membership',
		createdAt: new Date().toISOString(),
		context: {},
		event: eventType,
		data: {
			object: 'organization_membership',
			id: 'om_webhook',
			organizationId: 'workos_org_webhook',
			organizationName: 'WorkOS Webhook Org',
			status: 'active',
			userId: 'user_webhook',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			role: { slug: 'member' },
		},
	} as WorkosEvent
}

function buildIgnoredEvent(): WorkosEvent {
	return {
		id: 'event_workos_ignored',
		createdAt: new Date().toISOString(),
		context: {},
		event: 'user.updated',
		data: { object: 'user', id: 'user_ignored' },
	} as WorkosEvent
}

function createWorkosWebhookService(input?: { verifyError?: Error; activeSeatCount?: number; event?: WorkosEvent }): {
	service: WorkosSdkAdapter
	verifyCalls: string[]
	countCalls: string[]
} {
	const verifyCalls: string[] = []
	const countCalls: string[] = []
	const base = createMockWorkosService({
		verifyWebhook: async (payload: string, signature: string) => {
			verifyCalls.push(`${signature}:${payload}`)
			if (input?.verifyError) {
				throw input.verifyError
			}
			return input?.event ?? (JSON.parse(payload) as WorkosEvent)
		},
		getMembershipWebhookEvent: (event: WorkosEvent) => {
			if (
				event.event !== 'organization_membership.created' &&
				event.event !== 'organization_membership.updated' &&
				event.event !== 'organization_membership.deleted'
			) {
				return null
			}
			return {
				eventId: event.id,
				eventType: event.event,
				workosOrganizationId: (event.data as any).organizationId,
				userId: String((event.data as any).userId),
			}
		},
		countActiveOrganizationMemberships: async (workosOrganizationId: string) => {
			countCalls.push(workosOrganizationId)
			return input?.activeSeatCount ?? 2
		},
	})

	return { service: base, verifyCalls, countCalls }
}

function createStripeSeatService(input?: { updateError?: Error }): {
	service: IStripeService
	updates: Array<{ subscriptionItemId: string; quantity: number; prorationBehavior: string | undefined }>
} {
	const updates: Array<{ subscriptionItemId: string; quantity: number; prorationBehavior: string | undefined }> = []
	return {
		updates,
		service: createMockStripeService({
			findCurrentSubscriptionItemForCustomer: async (customerId: string) => ({
				subscriptionId: 'sub_webhook',
				subscriptionItemId: customerId === 'cus_webhook' ? 'si_webhook' : 'si_unknown',
				priceId: 'price_pro_test',
				quantity: 1,
			}),
			updateSubscriptionItemQuantity: async ({ subscriptionItemId, quantity, prorationBehavior }) => {
				updates.push({ subscriptionItemId, quantity, prorationBehavior })
				if (input?.updateError) {
					throw input.updateError
				}
				return { id: subscriptionItemId, quantity } as any
			},
		}),
	}
}

async function setupApp(input?: Parameters<typeof createWorkosWebhookService>[0] & { updateError?: Error }) {
	await insertOrganization()
	const workos = createWorkosWebhookService(input)
	const stripe = createStripeSeatService(input)
	const app = createApp({ db, workos: workos.service, stripe: stripe.service })
	return { app, workos, stripe }
}

describe('POST /webhooks/workos', () => {
	test('returns 200 after valid membership delivery synchronously syncs seats', async () => {
		const { app, workos, stripe } = await setupApp()
		const body = JSON.stringify(buildMembershipEvent())

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_valid' },
			body,
		})

		expect(response.status).toBe(200)
		const json = await response.json()
		expect((json as any).received).toBe(true)
		expect((json as any).seatSync).toMatchObject({
			organizationId: expect.any(String),
			reason: 'workos_webhook',
			seatCount: 2,
			subscriptionId: 'sub_webhook',
			subscriptionItemId: 'si_webhook',
		})
		expect(workos.verifyCalls).toEqual([`sig_valid:${body}`])
		expect(workos.countCalls).toEqual(['workos_org_webhook'])
		expect(stripe.updates).toEqual([
			{ subscriptionItemId: 'si_webhook', quantity: 2, prorationBehavior: 'create_prorations' },
		])
	})

	test('returns 400 when the signature header is missing', async () => {
		const { app, workos, stripe } = await setupApp()
		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(buildMembershipEvent()),
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Missing WorkOS-Signature header' })
		expect(workos.verifyCalls).toEqual([])
		expect(stripe.updates).toEqual([])
	})

	test('returns 400 for an invalid signature', async () => {
		const { app, stripe } = await setupApp({ verifyError: new Error('bad signature') })

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_bad' },
			body: JSON.stringify(buildMembershipEvent()),
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Invalid WorkOS webhook signature' })
		expect(stripe.updates).toEqual([])
	})

	test('returns 200 and ignores non-membership events', async () => {
		const { app, workos, stripe } = await setupApp()
		const body = JSON.stringify(buildIgnoredEvent())

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_valid' },
			body,
		})

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ received: true, ignored: true })
		expect(workos.verifyCalls).toEqual([`sig_valid:${body}`])
		expect(workos.countCalls).toEqual([])
		expect(stripe.updates).toEqual([])
	})

	test('returns 500 when processing fails after verification', async () => {
		const { app, workos, stripe } = await setupApp({ updateError: new Error('Stripe unavailable') })

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_valid' },
			body: JSON.stringify(buildMembershipEvent()),
		})

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({ error: 'WorkOS webhook processing failed' })
		expect(workos.countCalls).toEqual(['workos_org_webhook'])
		expect(stripe.updates).toHaveLength(1)
	})

	test('uses raw body for signature verification', async () => {
		const { app, workos } = await setupApp()
		const rawBody = JSON.stringify(buildMembershipEvent(), null, 2)
		const reparsedBody = JSON.stringify(JSON.parse(rawBody))

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_raw' },
			body: reparsedBody,
		})

		expect(response.status).toBe(200)
		expect(workos.verifyCalls).toEqual([`sig_raw:${reparsedBody}`])
	})

	test('membership.created backfills requester_user_id for anonymous access requests', async () => {
		const newUserId = `user-backfill-${randomUUID()}`
		const newUserEmail = `backfill-${randomUUID()}@example.com`
		const workosOrgId = 'workos_org_webhook'

		// Get org inserted by beforeAll
		await insertOrganization()
		const [organization] = await db
			.select()
			.from(organizations)
			.where(eq(organizations.workos_organization_id, workosOrgId))
			.limit(1)
		if (!organization) throw new Error('Expected org to exist')

		// Create artifact + anonymous access request
		const content = `# Backfill test ${randomUUID()}`
		const [artifact] = await db
			.insert(artifacts)
			.values({
				organization_id: organization.id,
				resource_owner_user_id: 'artifact-owner',
				file_name: `backfill-test-${randomUUID()}.md`,
				content,
				content_hash: hash(content),
				created_by: 'artifact-owner',
			})
			.returning()
		if (!artifact) throw new Error('Failed to create artifact')

		const [request] = await db
			.insert(accessRequests)
			.values({
				organization_id: organization.id,
				artifact_id: artifact.id,
				artifact_title_snapshot: artifact.file_name,
				artifact_owner_user_id: 'artifact-owner',
				requester_email: newUserEmail,
				requester_user_id: null,
				status: 'invited',
				notification_status: 'not_started',
			})
			.returning()
		if (!request) throw new Error('Failed to create access request')
		expect(request.requester_user_id).toBeNull()

		// Build a workos service that:
		// - verifies the webhook by JSON-parsing the body (like the mock does)
		// - returns getMembershipWebhookEvent for membership.created events
		// - returns the user email for getUser(newUserId)
		const workosForBackfill = createMockWorkosService({
			verifyWebhook: async (payload: string) => JSON.parse(payload) as WorkosEvent,
			getMembershipWebhookEvent: (event: WorkosEvent) => {
				if (event.event !== 'organization_membership.created') return null
				return {
					eventId: event.id,
					eventType: event.event as any,
					workosOrganizationId: String((event.data as any).organizationId),
					userId: String((event.data as any).userId),
				}
			},
			countActiveOrganizationMemberships: async () => 1,
			userManagement: {
				getUser: async (userId: string) => {
					if (userId === newUserId) {
						return {
							object: 'user' as any,
							id: newUserId,
							email: newUserEmail,
							firstName: 'Test',
							lastName: 'Backfill',
							emailVerified: true,
							createdAt: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							profilePictureUrl: null,
							lastSignInAt: null,
							locale: 'en',
							externalId: null,
							metadata: {},
						} as any
					}
					throw new Error(`User not found: ${userId}`)
				},
			},
		})

		const stripe = createStripeSeatService()
		const app = createApp({ db, workos: workosForBackfill, stripe: stripe.service })

		const eventBody = JSON.stringify({
			id: `event_membership_created_${Date.now()}`,
			createdAt: new Date().toISOString(),
			context: {},
			event: 'organization_membership.created',
			data: {
				object: 'organization_membership',
				id: `om_${randomUUID()}`,
				organizationId: workosOrgId,
				userId: newUserId,
				status: 'active',
				role: { slug: 'member' },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		})

		const response = await app.request('/webhooks/workos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'workos-signature': 'sig_backfill' },
			body: eventBody,
		})

		expect(response.status).toBe(200)

		// Verify the requester_user_id was backfilled
		const [updated] = await db.select().from(accessRequests).where(eq(accessRequests.id, request.id)).limit(1)
		expect(updated?.requester_user_id).toBe(newUserId)
	})
})
