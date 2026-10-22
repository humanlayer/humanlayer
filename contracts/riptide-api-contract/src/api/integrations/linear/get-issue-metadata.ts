import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const GetLinearIssueMetadataInputSchema = z.object({
	issueId: z.string(),
})
export const GetLinearIssueMetadataOutputSchema = z.object({
	identifier: z.string(),
	title: z.string(),
	url: z.string(),
	branch: z.string().nullable(),
})
export const getLinearIssueMetadataContract = contractBuilder
	.input(GetLinearIssueMetadataInputSchema)
	.output(GetLinearIssueMetadataOutputSchema)
