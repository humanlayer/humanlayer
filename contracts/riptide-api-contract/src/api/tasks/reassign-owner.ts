import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ReassignTaskOwnerInputSchema = z.object({
	taskId: z.uuidv7().describe('The task whose resource owner will change'),
	newOwnerUserId: z.string().min(1).describe('The active organization member who will become the owner'),
})

export const ReassignTaskOwnerOutputSchema = z.object({
	taskId: z.uuidv7(),
	previousOwnerUserId: z.string(),
	newOwnerUserId: z.string(),
	transactionId: z.string(),
})

export const reassignTaskOwnerContract = contractBuilder
	.input(ReassignTaskOwnerInputSchema)
	.output(ReassignTaskOwnerOutputSchema)
	.errors({
		TASK_OWNER_RECIPIENT_INELIGIBLE: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
		TASK_OWNER_UNCHANGED: {
			status: StatusCodes.BAD_REQUEST,
			data: z.object({ message: z.string() }),
		},
	})
