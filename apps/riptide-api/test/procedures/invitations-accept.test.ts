import { organizations } from '@humanlayer/db/tables/organizations'
import { call, isDefinedError } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { acceptUserInvitationProcedure } from '../../src/orpc/api/auth/user/invitations-accept'
import { createMockApiContextNoOrg, createMockStripeService, StatefulMockWorkosService } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('api/auth/user/invitations/accept', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let _db: PostgresJsDatabase

	beforeAll(async () => {
		const testDb = await createTestDb('invitations_accept')
		cleanupTestDb = testDb.cleanup
		_db = testDb.db
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	async function createSeatSyncFixture(workosOrganizationId: string) {
		const stripeCustomerId = `cus_${workosOrganizationId.replace(/[^a-zA-Z0-9]/g, '_')}`
		await _db.insert(organizations).values({
			name: `Invitation Accept Org ${workosOrganizationId}`,
			workos_organization_id: workosOrganizationId,
			stripe_customer_id: stripeCustomerId,
		})

		const countActiveOrganizationMemberships = vi.fn(async () => 2)
		const findCurrentSubscriptionItemForCustomer = vi.fn(async () => ({
			subscriptionId: 'sub_invitation_accept',
			subscriptionItemId: 'si_invitation_accept',
			priceId: 'price_pro_test',
			quantity: 1,
		}))
		const updateSubscriptionItemQuantity = vi.fn(async () => ({
			subscriptionItemId: 'si_invitation_accept',
			quantity: 2,
		}))

		return {
			countActiveOrganizationMemberships,
			findCurrentSubscriptionItemForCustomer,
			updateSubscriptionItemQuantity,
			stripe: createMockStripeService({
				findCurrentSubscriptionItemForCustomer,
				updateSubscriptionItemQuantity,
			}),
		}
	}

	function buildNoOrgContext(workos: StatefulMockWorkosService, userId: string) {
		return createMockApiContextNoOrg({
			auth: { userId },
			services: { workos },
		})
	}

	test('Successfully accepts a valid pending invitation', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_test123'
		const userEmail = 'test@example.com'
		const orgId = 'org_workos_123'

		workos.addUser({ id: userId, email: userEmail })
		const invitation = workos.addInvitation({
			email: userEmail,
			organizationId: orgId,
			state: 'pending',
			token: 'valid_token_123',
		})
		const seatSync = await createSeatSyncFixture(orgId)
		workos.countActiveOrganizationMemberships = seatSync.countActiveOrganizationMemberships

		const result = await call(
			acceptUserInvitationProcedure,
			{ invitationToken: 'valid_token_123' },
			{
				context: createMockApiContextNoOrg({
					auth: { userId },
					services: { workos, db: _db, dbReadReplica: _db, stripe: seatSync.stripe },
				}),
			},
		)

		expect(result.organizationId).toBe(orgId)

		// Verify invitation was marked as accepted
		const updatedInvitation = workos._invitations.get(invitation.id)
		expect(updatedInvitation?.state).toBe('accepted')
		expect(seatSync.countActiveOrganizationMemberships).toHaveBeenCalledWith(orgId)
		expect(seatSync.updateSubscriptionItemQuantity).toHaveBeenCalledWith({
			subscriptionItemId: 'si_invitation_accept',
			quantity: 2,
			prorationBehavior: 'create_prorations',
		})
	})

	test('Returns organizationId on success', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_abc'
		const userEmail = 'user@company.com'
		const expectedOrgId = 'org_expected_456'

		workos.addUser({ id: userId, email: userEmail })
		const invitation = workos.addInvitation({
			email: userEmail,
			organizationId: expectedOrgId,
			state: 'pending',
			token: 'token_abc',
		})
		const seatSync = await createSeatSyncFixture(expectedOrgId)
		workos.countActiveOrganizationMemberships = seatSync.countActiveOrganizationMemberships

		const result = await call(
			acceptUserInvitationProcedure,
			{ invitationToken: 'token_abc' },
			{
				context: createMockApiContextNoOrg({
					auth: { userId },
					services: { workos, db: _db, dbReadReplica: _db, stripe: seatSync.stripe },
				}),
			},
		)

		expect(result.organizationId).toBe(expectedOrgId)

		// Verify invitation state transition
		const updatedInvitation = workos._invitations.get(invitation.id)
		expect(updatedInvitation?.state).toBe('accepted')
		expect(seatSync.countActiveOrganizationMemberships).toHaveBeenCalledWith(expectedOrgId)
	})

	test('Rejects revoked invitation with INVITATION_REVOKED error', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_test456'
		const userEmail = 'revoked@example.com'

		workos.addUser({ id: userId, email: userEmail })
		workos.addInvitation({
			email: userEmail,
			organizationId: 'org_test',
			state: 'revoked',
			token: 'revoked_token',
		})

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'revoked_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INVITATION_REVOKED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVITATION_REVOKED')
			expect(error.data.message).toContain('removed')
		}
	})

	test('Rejects expired invitation with INVITATION_EXPIRED error', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_test789'
		const userEmail = 'expired@example.com'

		workos.addUser({ id: userId, email: userEmail })
		workos.addInvitation({
			email: userEmail,
			organizationId: 'org_test',
			state: 'expired',
			token: 'expired_token',
		})

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'expired_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INVITATION_EXPIRED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVITATION_EXPIRED')
			expect(error.data.message).toContain('expired')
		}
	})

	test('Rejects already accepted invitation with INVITATION_ALREADY_ACCEPTED error', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_accepted'
		const userEmail = 'already@example.com'

		workos.addUser({ id: userId, email: userEmail })
		workos.addInvitation({
			email: userEmail,
			organizationId: 'org_test',
			state: 'accepted',
			token: 'already_accepted_token',
		})

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'already_accepted_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INVITATION_ALREADY_ACCEPTED')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVITATION_ALREADY_ACCEPTED')
			expect(error.data.message).toContain('already been accepted')
		}
	})

	test('ADVERSARIAL - Rejects invitation meant for different email with INVITATION_NOT_FOUND', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_attacker'
		const userEmail = 'attacker@example.com'
		const targetEmail = 'victim@example.com'

		// User trying to accept invitation meant for someone else
		workos.addUser({ id: userId, email: userEmail })
		workos.addInvitation({
			email: targetEmail, // Different email!
			organizationId: 'org_secure',
			state: 'pending',
			token: 'secure_token',
		})

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'secure_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INVITATION_NOT_FOUND')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVITATION_NOT_FOUND')
			expect(error.data.message).toContain('Unable to locate this invitation')
		}
	})

	test('Returns INVITATION_NOT_FOUND for non-existent token', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_test'
		const userEmail = 'test@example.com'

		workos.addUser({ id: userId, email: userEmail })
		// No invitation added

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'nonexistent_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INVITATION_NOT_FOUND')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INVITATION_NOT_FOUND')
			expect(error.data.message).toContain('Unable to locate this invitation')
		}
	})

	test('Returns INTERNAL_SERVER_ERROR if WorkOS acceptInvitation fails', async () => {
		const workos = new StatefulMockWorkosService()
		const userId = 'user_error'
		const userEmail = 'error@example.com'

		workos.addUser({ id: userId, email: userEmail })
		const _invitation = workos.addInvitation({
			email: userEmail,
			organizationId: 'org_test',
			state: 'pending',
			token: 'error_token',
		})

		// Override acceptInvitation to throw an error
		const originalAcceptInvitation = workos.userManagement.acceptInvitation
		workos.userManagement.acceptInvitation = async () => {
			throw new Error('WorkOS service unavailable')
		}

		try {
			await call(
				acceptUserInvitationProcedure,
				{ invitationToken: 'error_token' },
				{
					context: buildNoOrgContext(workos, userId),
				},
			)
			expect.unreachable('Should have thrown INTERNAL_SERVER_ERROR')
		} catch (err) {
			const error = err as any
			expect(isDefinedError(error)).toBe(true)
			expect(error.code).toBe('INTERNAL_SERVER_ERROR')
			expect(error.data.message).toContain('Temporarily unable to accept this invitation')
		} finally {
			// Restore original method
			workos.userManagement.acceptInvitation = originalAcceptInvitation
		}
	})
})
