import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const CreateJiraRemoteLinkInputSchema = z.object({
	issueKey: z.string(),
	url: z.httpUrl(), // http or https URLs only
	title: z.string(),
	globalId: z.string(),
})
export const CreateJiraRemoteLinkOutputSchema = z.object({
	created: z.boolean(),
})
export const createJiraRemoteLinkContract = contractBuilder
	.input(CreateJiraRemoteLinkInputSchema)
	.output(CreateJiraRemoteLinkOutputSchema)
	.errors({
		JIRA_LINK_FAILED: {
			status: StatusCodes.BAD_GATEWAY,
			data: z.object({ message: z.string() }),
		},
	})
