import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const listHostAliasesOutputSchema = z.object({
	aliases: z.array(
		z.object({
			hostId: z.string(),
			displayName: z.string(),
		}),
	),
})

export const listHostAliasesContract = contractBuilder.input(z.object({})).output(listHostAliasesOutputSchema)
