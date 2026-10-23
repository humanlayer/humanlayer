import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { Sentry } from '../../../instrument'
import logger from '../../../logger'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const createPortalSessionProcedure = apiBaseForOrganizationAdmin.billing.createPortalSession.handler(
	async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { db, stripe } = context.services
		const { returnUrl } = input

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
				logger.warn({ organizationId }, 'Portal requested for organization without Stripe customer link')
				Sentry.captureException(
					new Error('Billing portal requested for organization without Stripe customer link'),
					{
						tags: { error_type: 'billing_portal_not_linked' },
						extra: { organizationId },
					},
				)
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe' } })
			}

			return await stripe.createPortalSession({
				customerId,
				returnUrl,
			})
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.createPortalSession',
				message: 'Failed to create Stripe portal session',
			})

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to create portal session' } })
		}
	},
)
