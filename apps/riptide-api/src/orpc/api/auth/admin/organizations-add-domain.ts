import { apiBaseForOrganizationAdmin } from '../../../base'

const CONSUMER_DOMAINS = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com']
const HOSTNAME_REGEX = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i

export const addDomainProcedure = apiBaseForOrganizationAdmin.auth.admin.organizations.addDomain.handler(
	async ({ input, context, errors }) => {
		const {
			auth,
			services: { workos },
		} = context

		const { domain } = input

		// Validate domain: hostname regex
		if (!HOSTNAME_REGEX.test(domain)) {
			throw errors.INVALID_DOMAIN({ data: { message: `Invalid domain format: ${domain}` } })
		}

		// Validate domain: exclude consumer domains
		if (CONSUMER_DOMAINS.includes(domain.toLowerCase())) {
			throw errors.INVALID_DOMAIN({ data: { message: `Consumer domain not allowed: ${domain}` } })
		}

		// Get current organization
		const org = await workos.organizations.getOrganization(auth.workosOrganizationId)

		// Check 5-domain limit
		if (org.domains.length >= 5) {
			throw errors.DOMAIN_LIMIT_EXCEEDED({ data: { message: 'Organizations cannot have more than 5 domains' } })
		}

		// Check duplicate
		if (org.domains.some((d) => d.domain === domain)) {
			throw errors.DOMAIN_ALREADY_EXISTS({ data: { message: 'This domain already exists in your organization' } })
		}

		await workos.organizationDomains.create({
			domain,
			organizationId: auth.workosOrganizationId,
		})

		return { success: true }
	},
)
