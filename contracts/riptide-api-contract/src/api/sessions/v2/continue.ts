import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ContinueV2InputSchema = z.object({
	sessionId: z.uuid(),
	messageId: z.uuid().optional().describe('Client-generated id for optimistic queued_messages row'),
	eventId: z
		.uuid()
		.optional()
		.describe('Client-generated id for the conversation_events row written on the continue/drain path'),
	text: z.string().min(1),
	intent: z.enum(['queue', 'send', 'interrupt_and_send']),
})

export const ContinueV2OutputSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('queued'), transactionId: z.string() }),
	z.object({ kind: z.literal('continued'), transactionId: z.string() }),
	z.object({
		kind: z.literal('rejected'),
		reason: z.enum(['not_found', 'forbidden', 'db_error']),
	}),
])

export const continueSessionV2Contract = contractBuilder.input(ContinueV2InputSchema).output(ContinueV2OutputSchema)
