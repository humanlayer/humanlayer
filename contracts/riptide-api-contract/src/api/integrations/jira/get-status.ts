import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetJiraStatusInputSchema = z.object({}).optional()
export const GetJiraStatusOutputSchema = z.object({
	enabled: z.boolean(),
	connected: z.boolean(),
	needsReauth: z.boolean(),
	siteUrl: z.httpUrl().nullable(), // http or https URLs only
	/**
	 * False when this deployment has no Jira keys; the other fields then say not connected.
	 * Optional so older clients and servers stay compatible.
	 */
	configured: z.boolean().optional(),
})
export const getJiraStatusContract = contractBuilder.input(GetJiraStatusInputSchema).output(GetJiraStatusOutputSchema)
