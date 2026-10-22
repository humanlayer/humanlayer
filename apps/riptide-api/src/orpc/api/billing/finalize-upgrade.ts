import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { refreshStripeBillingCache } from '../../../effects/services/billing/billing-access.service'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

/** @deprecated Retained for clients released before server-owned checkout completion. Remove after 2026-08-11. */
export const finalizeUpgradeProcedure = apiBaseForOrganizationAdmin.billing.finalizeUpgrade.handler(
	async ({ context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe } = context.services

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

			const customerId = parsedOrganization.data.stripe_customer_id
			if (!customerId) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe billing' } })
			}

			const proSubscription = await stripe.findActivePaidProSubscription({ customerId })
			if (!proSubscription) {
				const cache = await effectRuntime.runPromise(refreshStripeBillingCache(customerId))
				return { finalized: false, subscriptionStatus: cache.status }
			}

			const starterSubscription = await stripe.findNonCanceledStarterSubscription({ customerId })
			if (starterSubscription) {
				await stripe.cancelSubscription({ subscriptionId: starterSubscription.subscriptionId })
			}

			const cache = await effectRuntime.runPromise(refreshStripeBillingCache(customerId))
			return {
				finalized: true,
				canceledStarterSubscriptionId: starterSubscription?.subscriptionId ?? null,
				subscriptionStatus: cache.status,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.finalizeUpgrade',
				message: 'Failed to finalize Starter to Pro upgrade',
			})
			if (error instanceof ORPCError) throw error
			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to finalize upgrade' } })
		}
	},
)
