import { apiBaseOrgRequired } from '../../../base'

export const getCurrentOrganizationProcedure = apiBaseOrgRequired.auth.organizations.getCurrent.handler(
	async ({ context }) => {
		const {
			auth,
			services: { workos },
		} = context

		// Fetch organization from WorkOS
		const org = await workos.organizations.getOrganization(auth.workosOrganizationId)

		// Map domains with state
		return {
			id: org.id,
			name: org.name,
			domains: org.domains.map((d) => ({
				domain: d.domain,
				state: d.state,
			})),
		}
	},
)
