import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import z from 'zod/v4'

import { contractBuilder } from '../../contract-builder'

export const ListTasksInputSchema = z.object({
	userId: z.string().optional().describe('Filter by resource owner user ID'),
	limit: z.number().int().positive().max(100).default(50).describe('Max results to return'),
	offset: z.number().int().nonnegative().default(0).describe('Number of results to skip'),
})

export const ListTasksOutputSchema = z.object({
	rows: z.array(taskSelectSchema),
})

export const listTasksContract = contractBuilder.input(ListTasksInputSchema).output(ListTasksOutputSchema)
