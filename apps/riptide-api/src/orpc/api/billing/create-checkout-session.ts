import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'

import {
	InvalidLegacyBillingCheckoutClientError,
	resolveBillingCheckoutClient,
} from '../../../effects/services/billing-checkout-completion/billing-checkout-client'
import logger from '../../../logger'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const createCheckoutSessionProcedure = apiBaseForOrganizationAdmin.billing.createCheckoutSession.handler(
	async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe, workos } = context.services
		const { promoCode } = input

		try {
			const checkoutClient = await effectRuntime.runPromise(resolveBillingCheckoutClient(input, organizationId))
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
			let customerId = organizationData.stripe_customer_id
			if (!customerId) {
				logger.info({ organizationId }, 'Provisioning Stripe customer before checkout')

				const user = await workos.userManagement.getUser(context.auth.userId)
				const customer = await stripe.ensureStripeCustomerForOrg({
					organizationId,
					organizationName: organizationData.name,
					adminEmail: user.email,
					existingCustomerId: organizationData.stripe_customer_id,
				})

				customerId = customer.customerId

				const updateResult = await db
					.update(organizations)
					.set({ stripe_customer_id: customerId })
					.where(
						and(
							eq(organizations.id, organizationId),
							eq(organizations.updated_at, organizationData.updated_at),
						),
					)
					.returning({ id: organizations.id })

				if (updateResult.length === 0) {
					throw errors.BAD_REQUEST({
						data: { message: 'Organization was modified concurrently. Please try again.' },
					})
				}

				await stripe.ensureBillingOrgMappings({
					organizationId,
					customerId,
				})

				await workos.organizations.updateOrganization({
					organization: organizationData.workos_organization_id,
					stripeCustomerId: customerId,
					metadata: {
						internal_org_id: organizationId,
					},
				})
			}

			const quantity = await workos.countActiveOrganizationMemberships(organizationData.workos_organization_id)

			return await stripe.createCheckoutSession({
				checkoutAttemptId: checkoutClient.checkoutAttemptId,
				customerId,
				organizationId,
				client: checkoutClient.client,
				quantity,
				promoCode,
			})
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.createCheckoutSession',
				message: 'Failed to create Stripe checkout session',
			})

			if (error instanceof InvalidLegacyBillingCheckoutClientError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to create checkout session' } })
		}
	},
)
