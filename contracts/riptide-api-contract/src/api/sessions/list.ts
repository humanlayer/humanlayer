import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ListSessionsInputSchema = z.object({
	taskId: z.uuidv7().optional().describe('Filter by task ID'),
	userId: z.string().optional().describe('Filter by resource owner user ID'),
	limit: z.number().int().positive().max(100).default(50).describe('Max results to return'),
	offset: z.number().int().nonnegative().default(0).describe('Number of results to skip'),
})

export const ListSessionsOutputSchema = z.object({
	rows: z.array(sessionSelectSchema),
})

export const listSessionsContract = contractBuilder.input(ListSessionsInputSchema).output(ListSessionsOutputSchema)
