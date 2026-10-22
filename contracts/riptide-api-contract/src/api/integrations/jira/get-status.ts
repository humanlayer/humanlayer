import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetJiraStatusInputSchema = z.object({}).optional()
export const GetJiraStatusOutputSchema = z.object({
	enabled: z.boolean(),
	connected: z.boolean(),
	needsReauth: z.boolean(),
	siteUrl: z.httpUrl().nullable(), // http or https URLs only
})
export const getJiraStatusContract = contractBuilder.input(GetJiraStatusInputSchema).output(GetJiraStatusOutputSchema)
