import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetJiraIssueInputSchema = z.object({
	issueKey: z.string(),
})
export const GetJiraIssueOutputSchema = z.object({
	key: z.string(),
	summary: z.string(),
	url: z.string(),
	status: z.string().optional(),
	description: z.string().optional(),
})
export const getJiraIssueContract = contractBuilder.input(GetJiraIssueInputSchema).output(GetJiraIssueOutputSchema)
