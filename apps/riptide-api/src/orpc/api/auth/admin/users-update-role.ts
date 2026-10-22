import { ORPCError } from '@orpc/server'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { syncOrganizationSeatQuantity } from '../../../../lib/seat-sync'
import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

const WorkosErrorCode = Schema.Struct({ code: Schema.optionalKey(Schema.String) })

function parseWorkosErrorCode(error: unknown): string | undefined {
	return Option.getOrUndefined(Schema.decodeUnknownOption(WorkosErrorCode)(error))?.code
}

export const adminUpdateUserRoleProcedure = apiBaseForOrganizationAdmin.auth.admin.users.updateRole.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { db, stripe, workos },
		} = context

		// Prevent self-demotion
		if (input.userId === auth.userId && input.roleSlug !== 'admin') {
			throw errors.CANNOT_DEMOTE_SELF({
				data: { message: 'Cannot demote yourself from admin role' },
			})
		}

		try {
			// Find the membership
			const membershipsResult = await workos.userManagement.listOrganizationMemberships({
				userId: input.userId,
				organizationId: auth.workosOrganizationId,
				limit: 1,
			})

			const memberships = await membershipsResult.autoPagination()
			const membership = memberships[0]

			if (!membership) {
				throw errors.USER_NOT_FOUND({
					data: { message: 'User not found in organization' },
				})
			}

			// Update the membership role
			await workos.userManagement.updateOrganizationMembership(membership.id, {
				roleSlug: input.roleSlug,
			})
			await syncOrganizationSeatQuantity(
				{ organizationId: auth.organizationId, reason: 'first_party_membership_mutation' },
				{ workosService: workos, stripeService: stripe, db },
			)

			return { success: true }
		} catch (error: unknown) {
			if (error instanceof ORPCError) throw error

			if (parseWorkosErrorCode(error) === 'entity_not_found') {
				throw errors.USER_NOT_FOUND({
					data: { message: 'User not found in organization' },
				})
			}

			logger.error({ error }, 'Failed to update user role')
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
