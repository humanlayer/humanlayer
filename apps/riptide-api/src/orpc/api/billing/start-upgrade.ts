import { BillingKvService } from '@humanlayer/billing/billing-kv'
import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import {
	InvalidLegacyBillingCheckoutClientError,
	resolveBillingCheckoutClient,
} from '../../../effects/services/billing-checkout-completion/billing-checkout-client'
import { refreshStripeBillingCache } from '../../../effects/services/billing/billing-access.service'
import { buildBillingClientUrl } from '../../../lib/stripe-service'
import logger from '../../../logger'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'
import { captureInvalidBillingOrganizationRow } from './organization-billing-schema'

export const startUpgradeProcedure = apiBaseForOrganizationAdmin.billing.startUpgrade.handler(
	async ({ input, context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe, workos } = context.services

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
			if (!organizationData.stripe_customer_id) {
				throw errors.BAD_REQUEST({ data: { message: 'Organization is not linked to Stripe billing' } })
			}

			const customerId = organizationData.stripe_customer_id
			const proSubscription = await stripe.findActivePaidProSubscription({ customerId })
			if (proSubscription) {
				await effectRuntime.runPromise(refreshStripeBillingCache(customerId))
				return {
					url: buildBillingClientUrl({
						client: checkoutClient.client,
						param: { name: 'billing', value: 'starter_to_pro_finalized' },
					}),
					alreadyPro: true,
				}
			}

			const cache = await effectRuntime.runPromise(
				Effect.gen(function* () {
					const billingKv = yield* BillingKvService
					return yield* billingKv.getSubscriptionCache({ customerId })
				}),
			)
			if (!stripe.isStarterPriceId(cache?.priceId)) {
				throw errors.BAD_REQUEST({ data: { message: 'Only Starter organizations can start a Pro upgrade' } })
			}

			const quantity = await workos.countActiveOrganizationMemberships(organizationData.workos_organization_id)
			logger.info({ organizationId, customerId, quantity }, 'Starting Starter to Pro upgrade checkout')

			return await stripe.createProUpgradeCheckoutSession({
				checkoutAttemptId: checkoutClient.checkoutAttemptId,
				customerId,
				organizationId,
				client: checkoutClient.client,
				quantity,
			})
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.startUpgrade',
				message: 'Failed to start Starter to Pro upgrade',
			})
			if (error instanceof InvalidLegacyBillingCheckoutClientError) {
				throw errors.BAD_REQUEST({ data: { message: error.message } })
			}
			if (error instanceof ORPCError) throw error
			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to start upgrade' } })
		}
	},
)
