import { organizations } from '@humanlayer/db/tables/organizations'
import type { Invitation } from '@workos-inc/node'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { syncOrganizationSeatQuantity } from '../../../../lib/seat-sync'
import { logger } from '../../../../logger'
import { apiBaseNoOrg } from '../../../base'

export const acceptUserInvitationProcedure = apiBaseNoOrg.auth.user.invitations.accept.handler(
	async ({ context, input, errors }) => {
		// Destructure at top of handler to avoid long chains
		const {
			auth,
			services: { db, stripe, workos },
		} = context

		// Get user email
		const user = await workos.userManagement.getUser(auth.userId)

		// Find invitation by token
		let invitation: Invitation
		try {
			invitation = await workos.userManagement.findInvitationByToken(input.invitationToken)
			if (!invitation) {
				throw errors.INVITATION_NOT_FOUND({
					data: {
						message: 'Unable to locate this invitation.',
					},
				})
			}
		} catch (error) {
			logger.error(error, 'Unable to find invitation')
			throw errors.INVITATION_NOT_FOUND({
				data: {
					message: 'Unable to locate this invitation.',
				},
			})
		}

		// Validate invitation is for this user
		if (invitation.email !== user.email) {
			throw errors.INVITATION_NOT_FOUND({
				data: {
					message: 'Unable to locate this invitation.',
				},
			})
		}

		// Check invitation state
		switch (invitation.state) {
			case 'revoked':
				throw errors.INVITATION_REVOKED({
					data: {
						message: 'This invitation has been removed. Please ask your admin for another.',
					},
				})
			case 'expired':
				throw errors.INVITATION_EXPIRED({
					data: {
						message: 'This invitation has expired. Please ask your admin for another.',
					},
				})
			case 'accepted':
				throw errors.INVITATION_ALREADY_ACCEPTED({
					data: {
						message: 'This invitation has already been accepted.',
					},
				})
			case 'pending':
				// Accept the invitation
				try {
					const workosOrganizationId = invitation.organizationId
					if (!workosOrganizationId) {
						throw new Error('Invitation is missing organizationId')
					}
					await workos.userManagement.acceptInvitation(invitation.id)
					const organizationId = await getLocalOrganizationId(db, workosOrganizationId)
					await syncOrganizationSeatQuantity(
						{ organizationId, reason: 'first_party_membership_mutation' },
						{ workosService: workos, stripeService: stripe, db },
					)
					return { organizationId: workosOrganizationId }
				} catch (error) {
					logger.error({ invitationId: invitation.id, error }, 'Unable to accept invitation')
					throw errors.INTERNAL_SERVER_ERROR({
						data: {
							message: 'Temporarily unable to accept this invitation. Please try again later.',
						},
					})
				}
			default:
				logger.error({ state: invitation.state }, 'Unknown invitation state')
				throw errors.INTERNAL_SERVER_ERROR({
					data: {
						message: 'Temporarily unable to accept this invitation. Please try again later.',
					},
				})
		}
	},
)

async function getLocalOrganizationId(db: PostgresJsDatabase, workosOrganizationId: string): Promise<string> {
	const [organization] = await db
		.select({ id: organizations.id })
		.from(organizations)
		.where(eq(organizations.workos_organization_id, workosOrganizationId))
		.limit(1)

	if (!organization) {
		throw new Error(`Organization with WorkOS ID ${workosOrganizationId} was not found while accepting invitation`)
	}

	return organization.id
}
