import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

const LinearCommentSchema = z.object({
	author: z.string(),
	body: z.string(),
	createdAt: z.string(),
})

export const GetLinearIssueInputSchema = z.object({
	issueId: z.string(),
})
export const GetLinearIssueOutputSchema = z.object({
	identifier: z.string(),
	title: z.string(),
	url: z.string(),
	branch: z.string().nullable(),
	status: z.string(),
	assignee: z.string().nullable(),
	description: z.string().nullable(),
	comments: z.array(LinearCommentSchema),
	parents: z.array(
		z.object({
			identifier: z.string(),
			title: z.string(),
			status: z.string(),
			assignee: z.string().nullable(),
			description: z.string().nullable(),
			comments: z.array(LinearCommentSchema),
		}),
	),
})
export const getLinearIssueContract = contractBuilder
	.input(GetLinearIssueInputSchema)
	.output(GetLinearIssueOutputSchema)
