import { apiBaseForOrganizationAdmin } from '../../../base'

export const removeDomainProcedure = apiBaseForOrganizationAdmin.auth.admin.organizations.removeDomain.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { workos },
		} = context

		const { domain } = input

		// Get current organization
		const org = await workos.organizations.getOrganization(auth.workosOrganizationId)

		// Find domain in org
		const domainToRemove = org.domains.find((d) => d.domain === domain)
		if (!domainToRemove) {
			throw errors.DOMAIN_NOT_FOUND({ data: { message: 'Domain not found in organization' } })
		}

		await workos.organizationDomains.delete(domainToRemove.id)

		return { success: true }
	},
)
