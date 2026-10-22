import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ResearchInputSchema = z.object({
	question: z.string(),
	packageName: z.string(),
	language: z.string(),
})

export const ResearchOutputSchema = z.object({
	success: z.boolean(),
	response: z.string(),
})

export const researchContract = contractBuilder.input(ResearchInputSchema).output(ResearchOutputSchema)
