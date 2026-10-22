import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { RiptideClientSchema } from '../../../types/client'

export const CreateJiraInstallUrlInputSchema = z.object({
	client: RiptideClientSchema.default('cloud'),
})
export const CreateJiraInstallUrlOutputSchema = z.object({
	url: z.string(),
	expiresAt: z.number(),
})
export const createJiraInstallUrlContract = contractBuilder
	.input(CreateJiraInstallUrlInputSchema)
	.output(CreateJiraInstallUrlOutputSchema)
