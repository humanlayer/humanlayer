import { apiBaseNoOrg } from '../../../base'

export const listUserOrganizationsProcedure = apiBaseNoOrg.auth.user.organizations.list.handler(async ({ context }) => {
	// Destructure at top of handler to avoid long chains
	const {
		auth,
		services: { workos },
	} = context

	// Fetch user's organization memberships
	const memberships = await workos.userManagement.listOrganizationMemberships({
		userId: auth.userId,
		limit: 100,
	})

	const allMemberships = await memberships.autoPagination()

	// Get sign-in URLs and organization data in parallel
	const signInUrls = allMemberships.map((membership) =>
		workos.userManagement.getAuthorizationUrl({
			redirectUri: workos.config.redirectUri,
			clientId: workos.config.clientId,
			provider: 'authkit',
			organizationId: membership.organizationId,
		}),
	)

	const orgDataPromises = allMemberships.map((membership) =>
		workos.organizations.getOrganization(membership.organizationId),
	)

	const orgData = await Promise.all(orgDataPromises)

	// Build response
	const organizations = allMemberships.map((membership, i) => ({
		organizationId: membership.organizationId,
		organizationName: orgData[i]?.name || 'Unknown Organization',
		role: membership.role?.slug || 'member',
		signInUrl: signInUrls[i] || '',
		domains: orgData[i]?.domains?.filter((d) => d.state === 'verified').map((d) => d.domain) || [],
	}))

	return {
		organizations,
		activeOrganizationId: auth.organizationId ?? null,
	}
})
