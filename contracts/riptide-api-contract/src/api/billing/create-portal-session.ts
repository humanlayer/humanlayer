import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const CreatePortalSessionInputSchema = z.object({
	returnUrl: z.string().trim().url(),
})

export const CreatePortalSessionOutputSchema = z.object({
	url: z.httpUrl(),
})

export const createPortalSessionContract = contractBuilder
	.input(CreatePortalSessionInputSchema)
	.output(CreatePortalSessionOutputSchema)
