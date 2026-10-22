import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const UpdateLinearIssueStatusInputSchema = z.object({
	issueId: z.string(),
	statusName: z.string(),
})
export const UpdateLinearIssueStatusOutputSchema = z.object({
	updated: z.boolean(),
})
export const updateLinearIssueStatusContract = contractBuilder
	.input(UpdateLinearIssueStatusInputSchema)
	.output(UpdateLinearIssueStatusOutputSchema)
	.errors({
		LINEAR_STATUS_FAILED: {
			status: StatusCodes.BAD_GATEWAY,
			data: z.object({ message: z.string() }),
		},
	})
