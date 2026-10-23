import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const GenerateTitleInputSchema = z.object({
	text: z.string().min(1),
})

export const GenerateTitleOutputSchema = z.object({
	title: z.string(),
})

export const generateTitleContract = contractBuilder.input(GenerateTitleInputSchema).output(GenerateTitleOutputSchema)
