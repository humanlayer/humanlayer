import { apiBaseNoOrg } from '../../../base'

export const listUserInvitationsProcedure = apiBaseNoOrg.auth.user.invitations.list.handler(
	async ({ context, input }) => {
		// Destructure at top of handler to avoid long chains
		const {
			auth,
			services: { workos },
		} = context

		// Need to get user email - JWT only has user ID
		const user = await workos.userManagement.getUser(auth.userId)

		// Fetch invitations for user's email
		const invitations = await workos.userManagement.listInvitations({
			email: user.email,
		})

		const allInvitations = await invitations.autoPagination()
		const filteredInvitations = allInvitations.filter((inv) => inv.state === (input?.state || 'pending'))

		// Fetch organization details
		const orgPromises = filteredInvitations.map((inv) =>
			inv.organizationId ? workos.organizations.getOrganization(inv.organizationId) : Promise.resolve(null),
		)

		const organizations = await Promise.all(orgPromises)

		// Build response
		const invitationList = filteredInvitations.map((inv, i) => {
			const organization = organizations[i]
			return {
				id: inv.id,
				token: inv.token,
				acceptInvitationUrl: inv.acceptInvitationUrl,
				organizationId: inv.organizationId,
				organization: organization
					? {
							name: organization.name,
							domains: organization.domains.filter((d) => d.state === 'verified').map((d) => d.domain),
						}
					: null,
			}
		})

		return { invitations: invitationList }
	},
)
