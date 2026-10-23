import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const CreateQueuedMessageInputSchema = z.object({
	sessionId: z.uuidv7(),
	messageId: z.uuidv7().optional(),
	text: z.string().min(1),
})

export const CreateQueuedMessageOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const createQueuedMessageContract = contractBuilder
	.input(CreateQueuedMessageInputSchema)
	.output(CreateQueuedMessageOutputSchema)

export const DeleteQueuedMessageInputSchema = z.object({
	sessionId: z.uuidv7(),
	queuedMessageId: z.uuidv7(),
})

export const DeleteQueuedMessageOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const deleteQueuedMessageContract = contractBuilder
	.input(DeleteQueuedMessageInputSchema)
	.output(DeleteQueuedMessageOutputSchema)

export const UpdateQueuedMessageInputSchema = z.object({
	sessionId: z.uuidv7(),
	queuedMessageId: z.uuidv7(),
	text: z.string().min(1),
})

export const UpdateQueuedMessageOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const updateQueuedMessageContract = contractBuilder
	.input(UpdateQueuedMessageInputSchema)
	.output(UpdateQueuedMessageOutputSchema)
	.errors({
		QUEUED_MESSAGE_UPDATE_FAILED: {
			status: 400,
			data: z.object({ reason: z.enum(['already_delivered']) }),
		},
	})

export const SendNowQueuedMessageInputSchema = z.object({
	sessionId: z.uuidv7(),
	queuedMessageId: z.uuidv7(),
})

export const SendNowQueuedMessageOutputSchema = z.object({
	transactionId: z.string(),
	success: z.boolean(),
})

export const sendNowQueuedMessageContract = contractBuilder
	.input(SendNowQueuedMessageInputSchema)
	.output(SendNowQueuedMessageOutputSchema)
	.errors({
		QUEUED_MESSAGE_SEND_FAILED: {
			status: 409,
			data: z.object({ reason: z.enum(['already_delivered', 'not_pending']) }),
		},
	})
