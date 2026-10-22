import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ListUserOrganizationsInputSchema = z.object({}).optional()

export const ListUserOrganizationsOutputSchema = z.object({
	organizations: z.array(
		z.object({
			organizationId: z.string(),
			organizationName: z.string(),
			role: z.string(),
			signInUrl: z.string().url(),
			domains: z.array(z.string()),
		}),
	),
	activeOrganizationId: z.string().nullable(),
})

export const listUserOrganizationsContract = contractBuilder
	.input(ListUserOrganizationsInputSchema)
	.output(ListUserOrganizationsOutputSchema)
