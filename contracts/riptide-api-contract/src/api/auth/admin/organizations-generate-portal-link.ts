import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GeneratePortalLinkInputSchema = z.object({
	intent: z.literal('domain_verification'),
})
export const GeneratePortalLinkOutputSchema = z.object({ link: z.string() })

export const generatePortalLinkContract = contractBuilder
	.input(GeneratePortalLinkInputSchema)
	.output(GeneratePortalLinkOutputSchema)
