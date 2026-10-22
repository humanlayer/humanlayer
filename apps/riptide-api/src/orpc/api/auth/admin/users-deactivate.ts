import { ORPCError } from '@orpc/server'
import * as Sentry from '@sentry/node'
import type { OrganizationMembership } from '@workos-inc/node'

import { syncOrganizationSeatQuantity } from '../../../../lib/seat-sync'
import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const adminDeactivateUserProcedure = apiBaseForOrganizationAdmin.auth.admin.users.deactivate.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { db, stripe, workos },
		} = context

		if (input.userId === auth.userId) {
			throw errors.CANNOT_DEACTIVATE_SELF({
				data: { message: 'Cannot deactivate yourself from the organization' },
			})
		}

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

			if (membership.status !== 'active') {
				throw errors.INVALID_STATE({ data: { message: 'User membership is not active' } })
			}

			stage = 'last_admin_check'
			const allMembershipsResult = await workos.userManagement.listOrganizationMemberships({
				organizationId: auth.workosOrganizationId,
				statuses: ['active'],
			})
			const allMemberships = await allMembershipsResult.autoPagination()
			const activeAdminCount = allMemberships.filter(
				(membership: OrganizationMembership) => membership.role.slug === 'admin',
			).length

			if (membership.role?.slug === 'admin' && activeAdminCount <= 1) {
				throw errors.LAST_ADMIN({
					data: { message: 'Cannot deactivate the last active admin in the organization' },
				})
			}

			stage = 'workos_deactivation'
			await workos.userManagement.deactivateOrganizationMembership(membership.id)
			stage = 'seat_sync_after_deactivation'
			await syncOrganizationSeatQuantity(
				{ organizationId: auth.organizationId, reason: 'first_party_membership_mutation' },
				{ workosService: workos, stripeService: stripe, db },
			)

			return { success: true as const }
		} catch (error: unknown) {
			if (
				error instanceof ORPCError &&
				(error.code === 'CANNOT_DEACTIVATE_SELF' ||
					error.code === 'LAST_ADMIN' ||
					error.code === 'USER_NOT_FOUND' ||
					error.code === 'INVALID_STATE')
			) {
				throw error
			}

			const observabilityContext = {
				operation: 'deactivate_user',
				organizationId: auth.organizationId,
				workosOrganizationId: auth.workosOrganizationId,
				userId: input.userId,
				stage,
			}
			logger.error({ error, ...observabilityContext }, 'Failed to deactivate user')
			Sentry.captureException(error, { extra: observabilityContext })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
