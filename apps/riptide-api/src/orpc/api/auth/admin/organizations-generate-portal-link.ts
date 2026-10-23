import { apiBaseForOrganizationAdmin } from '../../../base'

export const generatePortalLinkProcedure =
	apiBaseForOrganizationAdmin.auth.admin.organizations.generatePortalLink.handler(async ({ input, context }) => {
		const {
			auth,
			services: { workos },
		} = context

		const { intent } = input

		const result = await workos.adminPortal.generateLink({
			organization: auth.workosOrganizationId,
			intent,
		})

		return { link: result.link }
	})
