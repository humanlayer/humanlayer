import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { refreshStripeBillingCache } from '../../../effects/services/billing/billing-access.service'
import { canDowngradeToStarter, STARTER_FREE_CAPACITY } from '../../../lib/free-capacity'
import logger from '../../../logger'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const downgradeToStarterProcedure = apiBaseForOrganizationAdmin.billing.downgradeToStarter.handler(
	async ({ context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe, workos } = context.services

		try {
			const [organization] = await db
				.select()
				.from(organizations)
				.where(eq(organizations.id, organizationId))
				.limit(1)
			if (!organization) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization not found' } })
			}

			const parsedOrganization = organizationSelectSchema.safeParse(organization)
			if (!parsedOrganization.success) {
				captureInvalidBillingOrganizationRow({
					organizationId,
					parseIssues: parsedOrganization.error.flatten(),
				})
				throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Invalid billing organization data' } })
			}

			const organizationData = parsedOrganization.data
			if (!organizationData.stripe_customer_id) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe billing' } })
			}

			const customerId = organizationData.stripe_customer_id
			const cache = await effectRuntime.runPromise(
				Effect.gen(function* () {
					const billingKv = yield* BillingKvService
					return yield* billingKv.getSubscriptionCache({ customerId })
				}),
			)
			if (!cache) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization billing state is not synced' } })
			}

			if (!stripe.isProPriceId(cache.priceId)) {
				throw errors.BAD_REQUEST({ data: { message: 'Only Pro organizations can downgrade to Starter' } })
			}

			const [activeMembers, pendingInvitations] = await Promise.all([
				workos.countActiveOrganizationMemberships(organizationData.workos_organization_id),
				workos.countPendingInvitations({ workosOrganizationId: organizationData.workos_organization_id }),
			])
			if (!canDowngradeToStarter({ activeMembers, pendingInvitations })) {
				throw errors.CAPACITY_EXCEEDED({
					data: {
						message:
							'Starter is available when active members plus pending invitations are within the free capacity.',
						currentActiveSeats: activeMembers,
						pendingInvitations,
						freeCapacity: STARTER_FREE_CAPACITY,
					},
				})
			}

			const proSubscription = await stripe.findActivePaidProSubscription({ customerId })
			if (!proSubscription) {
				const starterSubscription = await stripe.findNonCanceledStarterSubscription({ customerId })
				if (starterSubscription) {
					logger.warn(
						{ organizationId, customerId, starterSubscriptionId: starterSubscription.subscriptionId },
						'Pro downgrade requested but Stripe is already on Starter; syncing billing cache',
					)
					const syncedCache = await effectRuntime.runPromise(refreshStripeBillingCache(customerId))

					return {
						success: true as const,
						activeMemberCount: activeMembers,
						pendingInvitationCount: pendingInvitations,
						freeCapacity: STARTER_FREE_CAPACITY,
						starterSubscriptionId: starterSubscription.subscriptionId,
						canceledProSubscriptionId: null,
						subscriptionStatus: syncedCache.status,
					}
				}

				throw errors.BAD_REQUEST({ data: { message: 'No active paid Pro subscription was found' } })
			}

			logger.info(
				{ organizationId, customerId, activeMembers, pendingInvitations },
				'Downgrading Pro organization to Starter',
			)

			const downgrade = await stripe.downgradeProToStarter({
				customerId,
				organizationId,
				quantity: activeMembers,
			})
			let syncedCache
			try {
				syncedCache = await effectRuntime.runPromise(refreshStripeBillingCache(customerId))
			} catch (error) {
				logger.error(
					{ error, organizationId, customerId, stage: 'cache_sync_after_downgrade' },
					'Downgrade succeeded but billing cache synchronization failed',
				)
				throw error
			}

			return {
				success: true as const,
				activeMemberCount: activeMembers,
				pendingInvitationCount: pendingInvitations,
				freeCapacity: STARTER_FREE_CAPACITY,
				starterSubscriptionId: downgrade.starterSubscriptionId,
				canceledProSubscriptionId: downgrade.canceledProSubscriptionId,
				subscriptionStatus: syncedCache.status,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.downgradeToStarter',
				message: 'Failed to downgrade Pro organization to Starter',
			})
			if (error instanceof ORPCError) throw error
			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to downgrade to Starter' } })
		}
	},
)
