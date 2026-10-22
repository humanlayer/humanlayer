import { ORPCError } from '@orpc/server'

import { syncOrganizationSeatQuantity } from '../../../lib/seat-sync'
import { apiBaseForOrganizationAdmin } from '../../base'
import { logAndCaptureBillingProcedureError } from './errors'

export const resyncSeatsProcedure = apiBaseForOrganizationAdmin.billing.resyncSeats.handler(
	async ({ context, errors }) => {
		const { organizationId } = context.auth
		const { db, stripe, workos } = context.services

		try {
			const result = await syncOrganizationSeatQuantity(
				{ organizationId, reason: 'customer_force_sync' },
				{ db, stripeService: stripe, workosService: workos },
			)

			return {
				seatCount: result.seatCount,
				subscriptionId: result.subscriptionId,
				subscriptionItemId: result.subscriptionItemId,
				stripeQuantityChanged: result.stripeQuantityChanged,
			}
		} catch (error) {
			logAndCaptureBillingProcedureError({
				error,
				organizationId,
				operation: 'billing.resyncSeats',
				message: 'Failed to re-sync billing seat count',
			})

			if (error instanceof ORPCError) {
				throw error
			}

			throw errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to re-sync seat count' } })
		}
	},
)
