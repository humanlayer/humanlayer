import type { Invitation } from '@workos-inc/node'

import { apiBaseForOrganizationAdmin } from '../../../base'

export const listAdminInvitationsProcedure = apiBaseForOrganizationAdmin.auth.admin.invitations.list.handler(
	async ({ context }) => {
		const {
			auth,
			services: { workos },
		} = context

		const result = await workos.userManagement.listInvitations({
			organizationId: auth.workosOrganizationId,
		})
		const allInvitations = await result.autoPagination()

		return {
			invitations: allInvitations.map((invitation: Invitation) => ({
				id: invitation.id,
				email: invitation.email,
				state: invitation.state,
				createdAt: invitation.createdAt,
				expiresAt: invitation.expiresAt ?? undefined,
				acceptedAt: invitation.acceptedAt ?? undefined,
			})),
		}
	},
)
