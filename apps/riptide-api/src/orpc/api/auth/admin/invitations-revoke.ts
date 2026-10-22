import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const revokeAdminInvitationProcedure = apiBaseForOrganizationAdmin.auth.admin.invitations.revoke.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { workos },
		} = context

		// IDOR prevention: fetch invitation and validate it belongs to the current org
		const invitation = await workos.userManagement.getInvitation(input.invitationId).catch(() => {
			throw errors.INVITATION_NOT_FOUND({
				data: { message: 'Invitation not found' },
			})
		})

		if (invitation.organizationId !== auth.workosOrganizationId) {
			throw errors.INVITATION_NOT_FOUND({
				data: { message: 'Invitation not found' },
			})
		}

		try {
			await workos.userManagement.revokeInvitation(input.invitationId)
		} catch (error) {
			logger.error({ error }, 'Failed to revoke invitation')
			throw errors.INTERNAL_SERVER_ERROR()
		}

		return { success: true }
	},
)
