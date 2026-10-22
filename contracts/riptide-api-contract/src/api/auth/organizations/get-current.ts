import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetCurrentOrganizationInputSchema = z.object({})

export const GetCurrentOrganizationOutputSchema = z.object({
	id: z.string(),
	name: z.string(),
	domains: z.array(
		z.object({
			domain: z.string(),
			state: z.enum(['verified', 'pending', 'legacy_verified', 'failed']),
		}),
	),
})

export const getCurrentOrganizationContract = contractBuilder
	.input(GetCurrentOrganizationInputSchema)
	.output(GetCurrentOrganizationOutputSchema)
