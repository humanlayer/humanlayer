import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { refreshStripeBillingCache } from '../../../effects/services/billing/billing-access.service'
import logger from '../../../logger'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const syncCheckoutSessionProcedure = apiBaseForOrganizationAdmin.billing.syncCheckoutSession.handler(
	async ({ context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime } = context.services

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
				logger.warn({ organizationId }, 'Checkout sync requested for organization without Stripe customer link')
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe' } })
			}

			const cache = await effectRuntime.runPromise(refreshStripeBillingCache(customerId))
			return {
				syncedAt: cache.syncedAt,
				subscriptionStatus: cache.status,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.syncCheckoutSession',
				message: 'Failed to sync Stripe checkout session',
			})

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to sync checkout session' } })
		}
	},
)
