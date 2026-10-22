import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const CreateLinearAttachmentInputSchema = z.object({
	issueId: z.string(),
	url: z.string(),
	title: z.string(),
})
export const CreateLinearAttachmentOutputSchema = z.object({
	created: z.boolean(),
})
export const createLinearAttachmentContract = contractBuilder
	.input(CreateLinearAttachmentInputSchema)
	.output(CreateLinearAttachmentOutputSchema)
	.errors({
		LINEAR_ATTACHMENT_FAILED: {
			status: StatusCodes.BAD_GATEWAY,
			data: z.object({ message: z.string() }),
		},
	})
