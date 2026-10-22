import { randomUUID } from 'node:crypto'

import { organizations } from '@humanlayer/db/tables/organizations'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { adminDeactivateUserProcedure } from '../../src/orpc/api/auth/admin/users-deactivate'
import { listAdminUsersProcedure } from '../../src/orpc/api/auth/admin/users-list'
import { adminReactivateUserProcedure } from '../../src/orpc/api/auth/admin/users-reactivate'
import { adminRemoveUserProcedure } from '../../src/orpc/api/auth/admin/users-remove'
import { adminUpdateUserRoleProcedure } from '../../src/orpc/api/auth/admin/users-update-role'
import { billingKvLayerFromTestService, TestBillingKvService } from '../fixtures/billing-kv-runtime'
import { createMockApiAuth, createMockApiContext, createMockStripeService, StatefulMockWorkosService } from '../mocks'
import { createDefaultTestEffectRuntime } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('admin user membership mutations sync seats', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let workosOrganizationId: string
	let stripeCustomerId: string

	beforeAll(async () => {
		const testDb = await createTestDb('users_seat_sync')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		workosOrganizationId = `workos_${randomUUID()}`
		stripeCustomerId = `cus_${randomUUID().slice(0, 10)}`
		const [organization] = await db
			.insert(organizations)
			.values({
				name: 'Users Seat Sync Org',
				workos_organization_id: workosOrganizationId,
				stripe_customer_id: stripeCustomerId,
			})
			.returning()

		if (!organization) throw new Error('Unable to insert users seat sync organization')
		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function buildContext() {
		const kv = new TestBillingKvService()
		const workos = new StatefulMockWorkosService()
		workos.addOrganization({ id: workosOrganizationId, name: 'Users Seat Sync Org' })
		workos.addUser({ id: 'user_admin', email: 'admin@example.com' })
		workos.addUser({ id: 'user_admin_2', email: 'admin2@example.com' })
		workos.addUser({ id: 'user_member', email: 'member@example.com' })
		workos.addUser({ id: 'user_inactive', email: 'inactive@example.com' })
		workos.addMembership({
			id: 'om_admin',
			userId: 'user_admin',
			organizationId: workosOrganizationId,
			role: { slug: 'admin' },
		})
		workos.addMembership({
			id: 'om_admin_2',
			userId: 'user_admin_2',
			organizationId: workosOrganizationId,
			role: { slug: 'admin' },
		})
		workos.addMembership({
			id: 'om_member',
			userId: 'user_member',
			organizationId: workosOrganizationId,
			role: { slug: 'member' },
		})
		workos.addMembership({
			id: 'om_inactive',
			userId: 'user_inactive',
			organizationId: workosOrganizationId,
			role: { slug: 'member' },
			status: 'inactive',
		})

		const findCurrentSubscriptionItemForCustomer = vi.fn(async (customerId: string) => ({
			customerId,
			subscriptionId: 'sub_users_sync',
			subscriptionItemId: 'si_users_sync',
			priceId: 'price_pro_test',
			quantity: 3,
		}))
		const updateSubscriptionItemQuantity = vi.fn(async ({ subscriptionItemId, quantity }: any) => ({
			subscriptionItemId,
			quantity,
		}))
		const stripe = createMockStripeService({
			findCurrentSubscriptionItemForCustomer,
			updateSubscriptionItemQuantity,
		})

		return {
			kv,
			workos,
			findCurrentSubscriptionItemForCustomer,
			updateSubscriptionItemQuantity,
			context: createMockApiContext({
				auth: createMockApiAuth({
					userId: 'user_admin',
					organizationId,
					workosOrganizationId,
					role: 'admin',
					roles: ['admin'],
				}),
				services: {
					workos,
					db,
					dbReadReplica: db,
					stripe,
					effectRuntime: createDefaultTestEffectRuntime({ billingKv: billingKvLayerFromTestService(kv) }),
				},
			}),
		}
	}

	test('lists active and inactive memberships with status', async () => {
		const ctx = buildContext()

		const result = await call(listAdminUsersProcedure, {}, { context: ctx.context })

		expect(result.users).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'user_member', membershipId: 'om_member', status: 'active' }),
				expect.objectContaining({ id: 'user_inactive', membershipId: 'om_inactive', status: 'inactive' }),
			]),
		)
	})

	test('excludes a pending membership returned despite the WorkOS status filter', async () => {
		const ctx = buildContext()
		ctx.workos.addUser({ id: 'user_pending', email: 'pending@example.com' })
		ctx.workos.addMembership({
			id: 'om_pending',
			userId: 'user_pending',
			organizationId: workosOrganizationId,
			role: { slug: 'member' },
			status: 'pending',
		})

		const listOrganizationMemberships = ctx.workos.userManagement.listOrganizationMemberships
		ctx.workos.userManagement.listOrganizationMemberships = async (options) => {
			if (!options?.statuses?.includes('active') || !options.statuses.includes('inactive')) {
				return listOrganizationMemberships(options)
			}
			return listOrganizationMemberships({ ...options, statuses: ['active', 'inactive', 'pending'] })
		}

		const result = await call(listAdminUsersProcedure, {}, { context: ctx.context })

		expect(result.users.find((user) => user.id === 'user_pending')).toBeUndefined()
	})

	test('reports the per-user advanced metrics flag, defaulting to true', async () => {
		await db.insert(userSettings).values({
			user_id: 'user_member',
			organization_id: organizationId,
			metrics_advanced_enabled: false,
		})
		const ctx = buildContext()

		const result = await call(listAdminUsersProcedure, {}, { context: ctx.context })

		// An explicit exclusion is reported as such...
		expect(result.users.find((user) => user.id === 'user_member')?.metricsAdvancedEnabled).toBe(false)
		// ...while no settings row means no choice made, which collects — the panel has to agree
		// with daemon.settings.get, whose USER_DEFAULTS is true for the same reason.
		expect(result.users.find((user) => user.id === 'user_inactive')?.metricsAdvancedEnabled).toBe(true)
	})

	test('syncs seats after removing a user', async () => {
		const ctx = buildContext()

		const result = await call(adminRemoveUserProcedure, { userId: 'user_member' }, { context: ctx.context })

		expect(result.success).toBe(true)
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledWith(stripeCustomerId)
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_users_sync',
			quantity: 2,
			prorationBehavior: 'create_prorations',
		})
	})

	test('syncs seats after removing an inactive user', async () => {
		const ctx = buildContext()

		const result = await call(adminRemoveUserProcedure, { userId: 'user_inactive' }, { context: ctx.context })

		expect(result.success).toBe(true)
		expect(ctx.workos._memberships.has('om_inactive')).toBe(false)
		expect(ctx.findCurrentSubscriptionItemForCustomer).toHaveBeenCalledWith(stripeCustomerId)
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_users_sync',
			quantity: 3,
			prorationBehavior: 'create_prorations',
		})
	})

	test('syncs seats after deactivating a user', async () => {
		const ctx = buildContext()

		const result = await call(adminDeactivateUserProcedure, { userId: 'user_member' }, { context: ctx.context })

		expect(result.success).toBe(true)
		expect(ctx.workos._memberships.get('om_member')?.status).toBe('inactive')
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_users_sync',
			quantity: 2,
			prorationBehavior: 'create_prorations',
		})
	})

	test('rejects self-deactivation before syncing seats', async () => {
		const ctx = buildContext()

		try {
			await call(adminDeactivateUserProcedure, { userId: 'user_admin' }, { context: ctx.context })
			expect.unreachable('Expected self-deactivation to fail')
		} catch (error) {
			expect(isDefinedError(error)).toBe(true)
			expect((error as any).code).toBe('CANNOT_DEACTIVATE_SELF')
		}

		expect(ctx.updateSubscriptionItemQuantity).not.toHaveBeenCalled()
	})

	test('rejects deactivating the last active admin before syncing seats', async () => {
		const ctx = buildContext()
		ctx.workos._memberships.get('om_admin')!.status = 'inactive'

		try {
			await call(
				adminDeactivateUserProcedure,
				{ userId: 'user_admin_2' },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: 'user_admin',
							organizationId,
							workosOrganizationId,
							role: 'admin',
							roles: ['admin'],
						}),
						services: ctx.context.services,
					}),
				},
			)
			expect.unreachable('Expected last active admin deactivation to fail')
		} catch (error) {
			expect(isDefinedError(error)).toBe(true)
			expect((error as any).code).toBe('LAST_ADMIN')
		}

		expect(ctx.updateSubscriptionItemQuantity).not.toHaveBeenCalled()
	})

	test('syncs seats after reactivating a user', async () => {
		const ctx = buildContext()

		const result = await call(adminReactivateUserProcedure, { userId: 'user_inactive' }, { context: ctx.context })

		expect(result.success).toBe(true)
		expect(ctx.workos._memberships.get('om_inactive')?.status).toBe('active')
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_users_sync',
			quantity: 4,
			prorationBehavior: 'create_prorations',
		})
	})

	test('rejects Starter reactivation when capacity would be exceeded', async () => {
		const previousStarterPrice = process.env.STRIPE_PRICE_STARTER
		process.env.STRIPE_PRICE_STARTER = 'price_starter_test'
		const ctx = buildContext()
		await ctx.kv.setOrgCustomerId(organizationId, stripeCustomerId)
		await ctx.kv.setSubscriptionCache(stripeCustomerId, {
			customerId: stripeCustomerId,
			organizationId,
			subscriptionId: 'sub_starter',
			status: 'active',
			priceId: 'price_starter_test',
			currentPeriodEnd: null,
			hasPaidInvoice: false,
			hasPaymentMethod: false,
			pastDueAt: null,
			syncedAt: Date.now(),
		})

		try {
			await call(adminReactivateUserProcedure, { userId: 'user_inactive' }, { context: ctx.context })
			expect.unreachable('Expected capacity failure')
		} catch (error) {
			expect(isDefinedError(error)).toBe(true)
			expect((error as any).code).toBe('CAPACITY_EXCEEDED')
		} finally {
			process.env.STRIPE_PRICE_STARTER = previousStarterPrice
		}

		expect(ctx.workos._memberships.get('om_inactive')?.status).toBe('inactive')
		expect(ctx.updateSubscriptionItemQuantity).not.toHaveBeenCalled()
	})

	test('does not sync seats when removing a user fails before mutation', async () => {
		const ctx = buildContext()

		try {
			await call(adminRemoveUserProcedure, { userId: 'missing_user' }, { context: ctx.context })
			expect.unreachable('Expected missing user to fail')
		} catch (error) {
			expect(isDefinedError(error)).toBe(true)
			expect((error as any).code).toBe('USER_NOT_FOUND')
		}

		expect(ctx.updateSubscriptionItemQuantity).not.toHaveBeenCalled()
	})

	test('syncs seats after updating a user role', async () => {
		const ctx = buildContext()

		const result = await call(
			adminUpdateUserRoleProcedure,
			{ userId: 'user_member', roleSlug: 'admin' },
			{ context: ctx.context },
		)

		expect(result.success).toBe(true)
		expect(ctx.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_users_sync',
			quantity: 3,
			prorationBehavior: 'create_prorations',
		})
	})
})
