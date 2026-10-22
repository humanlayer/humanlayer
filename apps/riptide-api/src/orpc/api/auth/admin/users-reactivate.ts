import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { ORPCError } from '@orpc/server'
import * as Sentry from '@sentry/node'
import { Effect } from 'effect'

import { buildUpgradeRequiredData, canUseStarterCapacity } from '../../../../lib/free-capacity'
import { syncOrganizationSeatQuantity } from '../../../../lib/seat-sync'
import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const adminReactivateUserProcedure = apiBaseForOrganizationAdmin.auth.admin.users.reactivate.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { db, effectRuntime, stripe, workos },
		} = context

		let stage = 'membership_lookup'
		try {
			const membershipsResult = await workos.userManagement.listOrganizationMemberships({
				userId: input.userId,
				organizationId: auth.workosOrganizationId,
				statuses: ['active', 'inactive'],
				limit: 1,
			})
			const memberships = await membershipsResult.autoPagination()
			const membership = memberships[0]

			if (!membership) {
				throw errors.USER_NOT_FOUND({ data: { message: 'User not found in organization' } })
			}

			if (membership.status !== 'inactive') {
				throw errors.INVALID_STATE({ data: { message: 'User membership is not inactive' } })
			}

			stage = 'capacity_check'
			const customerId = await effectRuntime.runPromise(
				Effect.gen(function* () {
					const billingKv = yield* BillingKvService
					return yield* billingKv.getOrgCustomerId({ organizationId: auth.organizationId })
				}),
			)
			const cache = customerId
				? await effectRuntime.runPromise(
						Effect.gen(function* () {
							const billingKv = yield* BillingKvService
							return yield* billingKv.getSubscriptionCache({ customerId })
						}),
					)
				: null
			const isStarter = cache?.priceId === stripe.prices.starter

			if (isStarter) {
				const [activeMembers, pendingInvitations] = await Promise.all([
					workos.countActiveOrganizationMemberships(auth.workosOrganizationId),
					workos.countPendingInvitations({ workosOrganizationId: auth.workosOrganizationId }),
				])

				if (!canUseStarterCapacity({ activeMembers, pendingInvitations, additionalActiveMembers: 1 })) {
					throw errors.CAPACITY_EXCEEDED({
						data: buildUpgradeRequiredData({ activeMembers, pendingInvitations }),
					})
				}
			}

			stage = 'workos_reactivation'
			await workos.userManagement.reactivateOrganizationMembership(membership.id)
			stage = 'seat_sync_after_reactivation'
			await syncOrganizationSeatQuantity(
				{ organizationId: auth.organizationId, reason: 'first_party_membership_mutation' },
				{ workosService: workos, stripeService: stripe, db },
			)

			return { success: true as const }
		} catch (error: unknown) {
			if (
				error instanceof ORPCError &&
				(error.code === 'USER_NOT_FOUND' ||
					error.code === 'CAPACITY_EXCEEDED' ||
					error.code === 'INVALID_STATE')
			) {
				throw error
			}

			const observabilityContext = {
				operation: 'reactivate_user',
				organizationId: auth.organizationId,
				workosOrganizationId: auth.workosOrganizationId,
				userId: input.userId,
				stage,
			}
			logger.error({ error, ...observabilityContext }, 'Failed to reactivate user')
			Sentry.captureException(error, { extra: observabilityContext })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
