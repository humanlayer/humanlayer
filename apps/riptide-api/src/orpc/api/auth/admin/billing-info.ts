import { BillingKvCacheDecodeError, BillingKvService } from '@humanlayer/billing/billing-kv'
import type { BillingVisibilitySubscriptionStatus } from '@humanlayer/billing/types'
import { deriveBillingVisibilityModel } from '@humanlayer/billing/visibility'
import { organizationSelectSchema, organizations } from '@humanlayer/db/tables/organizations'
import { ORPCError } from '@orpc/server'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { billingTierForPriceId, priceIdByTierFromEnvironment } from '../../../../effects/services/billing/billing-tier'
import { Sentry } from '../../../../instrument'
import { STARTER_FREE_CAPACITY } from '../../../../lib/free-capacity'
import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'
import { logAndCaptureBillingProcedureError } from '../../billing/errors'
import { captureInvalidBillingOrganizationRow } from '../../billing/organization-billing-schema'

function toBillingSubscriptionStatus(status: string | null | undefined): BillingVisibilitySubscriptionStatus {
	switch (status) {
		case 'trialing':
		case 'active':
		case 'paused':
		case 'past_due':
		case 'unpaid':
		case 'none':
			return status
		default:
			return null
	}
}

export const billingInfoProcedure = apiBaseForOrganizationAdmin.auth.admin.billing.info.handler(
	async ({ context, errors }) => {
		const { organizationId } = context.auth
		const { db, effectRuntime, stripe, workos } = context.services

		try {
			const [organization] = await db
				.select()
				.from(organizations)
				.where(eq(organizations.id, organizationId))
				.limit(1)

			const parsedOrganization = organization ? organizationSelectSchema.safeParse(organization) : null
			if (parsedOrganization && !parsedOrganization.success) {
				captureInvalidBillingOrganizationRow({
					organizationId,
					parseIssues: parsedOrganization.error.flatten(),
				})
				throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Invalid billing organization data' } })
			}

			const stripeCustomerId = parsedOrganization?.data.stripe_customer_id ?? null
			const activeSeatCount = organization
				? await workos.countActiveOrganizationMemberships(parsedOrganization?.data.workos_organization_id ?? '')
				: null
			const pendingInvitationCount = organization
				? await workos.countPendingInvitations({
						workosOrganizationId: parsedOrganization?.data.workos_organization_id ?? '',
					})
				: null

			if (!stripeCustomerId) {
				const visibility = deriveBillingVisibilityModel({
					stripeCustomerId,
					tier: null,
					subscriptionStatus: stripeCustomerId ? 'none' : null,
				})

				return {
					...visibility,
					hasPaymentMethod: null,
					paymentMethod: null,
					discount: null,
					nextInvoice: null,
					stripeCustomerId,
					subscriptionId: null,
					priceId: null,
					currentPeriodEnd: null,
					syncedAt: null,
					activeSeatCount,
					pendingInvitationCount,
					freeCapacity: STARTER_FREE_CAPACITY,
				}
			}

			let cache = null

			try {
				cache = await effectRuntime.runPromise(
					Effect.gen(function* () {
						const billingKv = yield* BillingKvService
						return yield* billingKv.getSubscriptionCache({ customerId: stripeCustomerId })
					}),
				)
			} catch (error) {
				if (!(error instanceof BillingKvCacheDecodeError)) {
					throw error
				}

				logger.error(
					{ error, organizationId, stripeCustomerId },
					'Billing info subscription cache failed schema validation',
				)
				Sentry.captureException(error, {
					tags: {
						error_type: 'billing_info_subscription_cache_parse_error',
					},
					extra: { organizationId, stripeCustomerId },
				})
			}

			const subscriptionStatus = cache ? toBillingSubscriptionStatus(cache.status) : 'none'
			const priceId = cache?.priceId ?? null
			const tier = billingTierForPriceId(priceId, priceIdByTierFromEnvironment())
			const visibility = deriveBillingVisibilityModel({
				stripeCustomerId,
				tier,
				subscriptionStatus,
			})
			const liveDetails = await stripe.getCurrentSubscriptionDetails(stripeCustomerId)
			const nextInvoice = liveDetails?.subscriptionId
				? await stripe.getUpcomingInvoice(liveDetails.subscriptionId)
				: null

			return {
				...visibility,
				hasPaymentMethod: cache?.hasPaymentMethod ?? null,
				paymentMethod: liveDetails?.paymentMethod ?? null,
				discount: liveDetails?.discount ?? null,
				nextInvoice,
				stripeCustomerId,
				subscriptionId: cache?.subscriptionId ?? null,
				priceId,
				currentPeriodEnd: cache?.currentPeriodEnd ?? null,
				syncedAt: cache?.syncedAt ?? null,
				activeSeatCount,
				pendingInvitationCount,
				freeCapacity: STARTER_FREE_CAPACITY,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'auth.admin.billing.info',
				message: 'Failed to fetch billing info',
			})

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to fetch billing information' } })
		}
	},
)
