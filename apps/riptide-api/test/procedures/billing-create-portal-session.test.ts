import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { createPortalSessionProcedure } from '../../src/orpc/api/billing/create-portal-session'
import { createMockApiAuth, createMockApiContext, createMockStripeService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('billing.createPortalSession', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('billing_create_portal_session')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Billing Portal Org',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) {
			throw new Error('Unable to insert billing portal organization')
		}

		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	const returnUrl = 'http://localhost:3000/auth/organizations/select'

	function buildContext(overrides?: { role?: string; roles?: string[] }) {
		const auth = createMockApiAuth({
			organizationId,
			workosOrganizationId: `workos_${organizationId}`,
			role: overrides?.role ?? 'admin',
			roles: overrides?.roles ?? ['admin'],
		})

		const createPortalSession = vi.fn(async () => ({ url: 'https://billing.stripe.com/p/session/test_123' }))
		const stripe = createMockStripeService({
			createPortalSession,
		})

		return {
			auth,
			createPortalSession,
			context: createMockApiContext({
				auth,
				services: {
					db,
					dbReadReplica: db,
					stripe,
				},
			}),
		}
	}

	test('creates portal session for admin org with linked customer', async () => {
		const ctx = buildContext()

		const result = await call(createPortalSessionProcedure, { returnUrl }, { context: ctx.context })

		expect(result.url).toBe('https://billing.stripe.com/p/session/test_123')
		expect(ctx.createPortalSession).toHaveBeenCalledTimes(1)
		expect(ctx.createPortalSession).toHaveBeenCalledWith({
			customerId: stripeCustomerId,
			returnUrl,
		})
	})

	test('rejects non-admin users', async () => {
		const ctx = buildContext({ role: '', roles: [] })

		await expect(call(createPortalSessionProcedure, { returnUrl }, { context: ctx.context })).rejects.toThrow()
	})

	test('rejects organizations without stripe_customer_id', async () => {
		const [orgWithoutCustomer] = await db
			.insert(organizations)
			.values({
				name: 'No Stripe Org for Portal',
				workos_organization_id: `workos_${randomUUID()}`,
				stripe_customer_id: null,
			})
			.returning()

		if (!orgWithoutCustomer) {
			throw new Error('Unable to insert org without stripe customer for portal test')
		}

		const auth = createMockApiAuth({
			organizationId: orgWithoutCustomer.id,
			workosOrganizationId: `workos_${orgWithoutCustomer.id}`,
			role: 'admin',
			roles: ['admin'],
		})

		await expect(
			call(
				createPortalSessionProcedure,
				{ returnUrl },
				{
					context: createMockApiContext({
						auth,
						services: {
							db,
							dbReadReplica: db,
							stripe: createMockStripeService({
								createPortalSession: vi.fn(async () => ({
									url: 'https://billing.stripe.com/p/session/test_missing',
								})),
							}),
						},
					}),
				},
			),
		).rejects.toThrow()
	})
})
