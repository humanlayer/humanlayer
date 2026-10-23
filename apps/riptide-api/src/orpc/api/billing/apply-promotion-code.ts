import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'

import { refreshStripeBillingCache } from '../../../effects/services/billing/billing-access.service'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const applyPromotionCodeProcedure = apiBaseForOrganizationAdmin.billing.applyPromotionCode.handler(
	async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe } = context.services
		const { code } = input

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

			const stripeCustomerId = parsedOrganization.data.stripe_customer_id
			if (!stripeCustomerId) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe billing' } })
			}

			const subscription = await stripe.findCurrentSubscriptionItemForCustomer(stripeCustomerId)
			if (!subscription) {
				throw errors.BAD_REQUEST({
					data: { message: 'No active Stripe subscription found for this organization' },
				})
			}

			const promotionCode = await stripe.resolvePromotionCode(code)
			if (!promotionCode) {
				throw errors.INVALID_PROMO_CODE({ data: { message: 'This promo code is not valid.' } })
			}

			const applied = await stripe.applyPromotionCode({
				subscriptionId: subscription.subscriptionId,
				promotionCodeId: promotionCode.id,
			})

			await effectRuntime.runPromise(refreshStripeBillingCache(stripeCustomerId))

			return {
				subscriptionId: applied.subscriptionId,
				promotionCodeId: applied.promotionCodeId,
				code: promotionCode.code,
				discountId: applied.discountId,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.applyPromotionCode',
				message: 'Failed to apply Stripe promotion code',
			})

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to apply promotion code' } })
		}
	},
)
