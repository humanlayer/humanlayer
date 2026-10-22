import { ORPCError } from '@orpc/server'
import type { OrganizationMembership } from '@workos-inc/node'

import { syncOrganizationSeatQuantity } from '../../../../lib/seat-sync'
import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const adminRemoveUserProcedure = apiBaseForOrganizationAdmin.auth.admin.users.remove.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { db, stripe, workos },
		} = context

		// Prevent self-removal
		if (input.userId === auth.userId) {
			throw errors.CANNOT_REMOVE_SELF({
				data: { message: 'Cannot remove yourself from the organization' },
			})
		}

		try {
			// Find the membership to delete
			const membershipsResult = await workos.userManagement.listOrganizationMemberships({
				userId: input.userId,
				organizationId: auth.workosOrganizationId,
				statuses: ['active', 'inactive'],
				limit: 1,
			})

			const memberships = await membershipsResult.autoPagination()
			const membership = memberships[0]

			if (!membership) {
				throw errors.USER_NOT_FOUND({
					data: { message: 'User not found in organization' },
				})
			}

			// Check if this would leave no admins
			const allMembershipsResult = await workos.userManagement.listOrganizationMemberships({
				organizationId: auth.workosOrganizationId,
			})

			const allMemberships = await allMembershipsResult.autoPagination()
			const adminCount = allMemberships.filter(
				(membership: OrganizationMembership) => membership.role.slug === 'admin',
			).length

			if (membership.role?.slug === 'admin' && adminCount <= 1) {
				throw errors.LAST_ADMIN({
					data: { message: 'Cannot remove the last admin from the organization' },
				})
			}

			// Delete the membership
			await workos.userManagement.deleteOrganizationMembership(membership.id)
			await syncOrganizationSeatQuantity(
				{ organizationId: auth.organizationId, reason: 'first_party_membership_mutation' },
				{ workosService: workos, stripeService: stripe, db },
			)

			return { success: true }
		} catch (error: unknown) {
			if (error instanceof ORPCError) throw error

			logger.error({ error }, 'Failed to remove user')
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
