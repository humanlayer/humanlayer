import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const upsertHostAliasInputSchema = z.object({
	hostId: z.string(),
	displayName: z.string().min(1).max(64),
})

export const upsertHostAliasOutputSchema = z.object({
	hostId: z.string(),
	displayName: z.string(),
})

export const upsertHostAliasContract = contractBuilder
	.input(upsertHostAliasInputSchema)
	.output(upsertHostAliasOutputSchema)
