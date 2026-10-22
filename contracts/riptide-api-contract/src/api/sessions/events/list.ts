import { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'

export const ListSessionEventsInputSchema = z.object({
	sessionId: z.uuidv7().describe('Session ID (required)'),
	role: z.enum(['user', 'assistant', 'system']).optional().describe('Filter by role'),
	limit: z.number().int().positive().max(1000).default(1000).describe('Max results to return'),
	offset: z.number().int().nonnegative().default(0).describe('Number of results to skip'),
})

export const ListSessionEventsOutputSchema = z.object({
	rows: z.array(conversationEventSelectSchema),
})

export const listSessionEventsContract = contractBuilder
	.input(ListSessionEventsInputSchema)
	.output(ListSessionEventsOutputSchema)
